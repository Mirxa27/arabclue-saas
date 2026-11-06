/**
 * Meta Messenger + Instagram Direct adapter (Graph Send API) and connect-time checks.
 *
 * The merchant connects a Facebook Page (and, for Instagram, the linked IG
 * professional account) from their own Meta app and stores a Page access token.
 * Both Messenger and Instagram messaging post to the same Send API on the page
 * node; the recipient id is a PSID (Messenger) or IGSID (Instagram), taken from
 * the inbound message event (see lib/employees/channels/meta-inbound.ts).
 *
 * Docs:
 *   https://developers.facebook.com/docs/messenger-platform/send-messages
 *   https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message
 *   https://developers.facebook.com/docs/messenger-platform/error-codes
 */
import { GraphApiError, graphErrorBody, graphUrl } from "@/lib/meta/graph";

export type MetaMessagingCredentials = {
  page_id: string;
  page_access_token: string;
  /** Instagram professional account id (kind "instagram"); resolved from the Page at connect. */
  ig_account_id?: string;
  /** Key for X-Hub-Signature-256 — the merchant's own Meta app secret. */
  app_secret?: string;
  /** The App Dashboard "Verify Token" for the webhook handshake. */
  verify_token?: string;
};

export type MetaSendResult = { messageId: string; recipientId: string };

export type MetaChannel = "meta" | "instagram";

const GRAPH_TIMEOUT_MS = 15_000;

// ─── Outbound text limits ──────────────────────────────────────────────────

/** Instagram: "Message text must be UTF-8 and be 1,000 bytes or less" (~500 Arabic letters). */
export const INSTAGRAM_MAX_TEXT_BYTES = 1000;
/** Messenger: text must be under 2,000 characters (measured here in UTF-16 units — never more than code points). */
export const MESSENGER_MAX_TEXT_CHARS = 2000;

const WHITESPACE = /\s/u;

/**
 * Split a reply into Send API-sized messages: at most 1000 UTF-8 bytes each on
 * Instagram, 2000 characters on Messenger. Cuts at a line break or space in the
 * second half of a window when there is one, never inside a code point.
 */
export function splitMetaText(channel: MetaChannel, text: string): string[] {
  const limit = channel === "instagram" ? INSTAGRAM_MAX_TEXT_BYTES : MESSENGER_MAX_TEXT_CHARS;
  const weigh = channel === "instagram" ? (cp: string) => Buffer.byteLength(cp, "utf8") : (cp: string) => cp.length;
  const cps = Array.from(text.trim());
  const chunks: string[] = [];
  let start = 0;
  while (start < cps.length) {
    while (start < cps.length && WHITESPACE.test(cps[start])) start++;
    if (start >= cps.length) break;

    let size = 0;
    let end = start;
    let lastBreak = -1;
    let lastSpace = -1;
    while (end < cps.length) {
      const w = weigh(cps[end]);
      if (size + w > limit) break;
      size += w;
      if (cps[end] === "\n") lastBreak = end;
      else if (WHITESPACE.test(cps[end])) lastSpace = end;
      end++;
    }

    let cut = end;
    if (end < cps.length) {
      const minCut = start + Math.floor((end - start) / 2);
      if (lastBreak >= minCut) cut = lastBreak;
      else if (lastSpace >= minCut) cut = lastSpace;
    }
    const chunk = cps.slice(start, cut).join("").trimEnd();
    if (chunk) chunks.push(chunk);
    start = cut;
  }
  return chunks;
}

// ─── Send API ──────────────────────────────────────────────────────────────

async function postMessage(
  label: string,
  creds: MetaMessagingCredentials,
  to: string,
  text: string
): Promise<MetaSendResult> {
  const res = await fetch(graphUrl([creds.page_id, "messages"]), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.page_access_token}`
    },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text },
      messaging_type: "RESPONSE"
    }),
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
  });

  const json = (await res.json().catch(() => ({}))) as { message_id?: string; recipient_id?: string };
  if (!res.ok || !json.message_id) {
    throw new GraphApiError(`${label} send failed`, res.status, graphErrorBody(json), res.statusText || "no message id");
  }
  return { messageId: json.message_id, recipientId: json.recipient_id ?? to };
}

/**
 * Send a text reply. Long replies go out as several messages in order; the
 * result carries the first message id. A failure throws GraphApiError (Meta's
 * code/subcode kept for classifyMetaSendFailure).
 */
export async function sendMetaDirectMessage(
  channel: MetaChannel,
  creds: MetaMessagingCredentials,
  to: string,
  body: string
): Promise<MetaSendResult> {
  const label = channel === "instagram" ? "Instagram" : "Messenger";
  if (!creds.page_id) throw new Error(`${label}: page_id missing`);
  if (!creds.page_access_token) throw new Error(`${label}: page_access_token missing`);
  if (!to) throw new Error(`${label}: recipient id is required`);

  const chunks = splitMetaText(channel, body);
  if (chunks.length === 0) throw new Error(`${label}: message text is empty`);

  let first: MetaSendResult | null = null;
  for (const chunk of chunks) {
    const sent = await postMessage(label, creds, to, chunk);
    first ??= sent;
  }
  return first as MetaSendResult;
}

// ─── Send failure classification ───────────────────────────────────────────

/**
 * Stable reasons for a failed send. `integration` failures mean every reply on
 * this channel will fail until the merchant fixes the connection (the
 * integration is flagged `status='error'`); `conversation` failures concern one
 * customer; `transient` ones are worth retrying later.
 */
export type MetaSendFailureReason =
  | "token_invalid"
  | "permission_missing"
  | "instagram_access_disabled"
  | "page_restricted"
  | "instagram_not_linked"
  | "capability_missing"
  | "account_not_eligible"
  | "outside_window"
  | "recipient_unavailable"
  | "not_thread_owner"
  | "rate_limited"
  | "temporary"
  | "unknown";

export type MetaSendFailureScope = "integration" | "conversation" | "transient";

export type MetaSendFailure = {
  reason: MetaSendFailureReason;
  scope: MetaSendFailureScope;
  code?: number;
  subcode?: number;
  message: string;
};

const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278, 2018065]);
const RECIPIENT_UNAVAILABLE_10_SUBCODES = new Set([2018108, 1893015]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

function failure(
  reason: MetaSendFailureReason,
  scope: MetaSendFailureScope,
  err: GraphApiError | null,
  message: string
): MetaSendFailure {
  return { reason, scope, code: err?.code, subcode: err?.subcode, message };
}

/** Map a Send API error to a reason (Messenger Platform error-codes reference). */
export function classifyMetaSendFailure(err: unknown): MetaSendFailure {
  const message = err instanceof Error ? err.message : String(err);
  if (!(err instanceof GraphApiError)) return failure("temporary", "transient", null, message);

  const { code, subcode, status } = err;
  switch (code) {
    case 190:
    case 102:
      return failure("token_invalid", "integration", err, message);
    case 3:
      return failure("capability_missing", "integration", err, message);
    case 36103:
      return failure("account_not_eligible", "integration", err, message);
    case 551:
      return failure("recipient_unavailable", "conversation", err, message);
    case 200:
      if (subcode === 2534041) return failure("instagram_access_disabled", "integration", err, message);
      if (subcode === 1545041) return failure("recipient_unavailable", "conversation", err, message);
      return failure("permission_missing", "integration", err, message);
    case 10:
      if (subcode === undefined) return failure("permission_missing", "integration", err, message);
      if (OUTSIDE_WINDOW_SUBCODES.has(subcode)) return failure("outside_window", "conversation", err, message);
      if (RECIPIENT_UNAVAILABLE_10_SUBCODES.has(subcode)) return failure("recipient_unavailable", "conversation", err, message);
      if (subcode === 1893063) return failure("page_restricted", "integration", err, message);
      if (subcode === 2534077) return failure("instagram_not_linked", "integration", err, message);
      // Meta Business AI owns the thread (Conversation Routing) — that conversation only.
      if (subcode === 2018300) return failure("not_thread_owner", "conversation", err, message);
      return failure("unknown", "conversation", err, message);
    case 100:
      if (subcode === 2534014) return failure("recipient_unavailable", "conversation", err, message);
      if (subcode === 2534037) return failure("not_thread_owner", "conversation", err, message);
      if (subcode === 2534013) return failure("instagram_not_linked", "integration", err, message);
      if (subcode === 2534029) return failure("page_restricted", "integration", err, message);
      if (subcode === 33) return failure("permission_missing", "integration", err, message);
      return failure("unknown", "conversation", err, message);
    case 1:
    case 2:
      return failure("temporary", "transient", err, message);
    default:
      if (code !== undefined && RATE_LIMIT_CODES.has(code)) return failure("rate_limited", "transient", err, message);
      if (status >= 500 || code === undefined) return failure("temporary", "transient", err, message);
      return failure("unknown", "transient", err, message);
  }
}

// ─── Connect-time checks ───────────────────────────────────────────────────

export type MetaPageIdentity = { id: string; name: string | null; instagramAccountId: string | null };

function idString(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

/** GET /me with the Page token: the Page the token belongs to, and its linked IG account. */
export async function inspectMetaPageToken(creds: Pick<MetaMessagingCredentials, "page_access_token">): Promise<MetaPageIdentity> {
  const res = await fetch(graphUrl("me", { fields: "id,name,instagram_business_account" }), {
    headers: { authorization: `Bearer ${creds.page_access_token}` },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: unknown;
    name?: unknown;
    instagram_business_account?: { id?: unknown };
  };
  if (!res.ok) throw new GraphApiError("Meta token check failed", res.status, graphErrorBody(json), res.statusText);
  const id = idString(json.id);
  if (!id) throw new GraphApiError("Meta token check failed", res.status, undefined, "no id returned");
  return {
    id,
    name: typeof json.name === "string" ? json.name : null,
    instagramAccountId: idString(json.instagram_business_account?.id)
  };
}

export type MetaSubscriptionResult = { ok: true } | { ok: false; error: string };

/**
 * POST /{page_id}/subscribed_apps?subscribed_fields=messages — subscribes the
 * merchant's app to the Page so Meta delivers DM webhooks ("You will need to
 * subscribe your Page to the Webhooks notifications you want to receive").
 * Never throws: a failed subscription is reported, not fatal.
 */
export async function subscribeMetaPageToMessages(creds: MetaMessagingCredentials): Promise<MetaSubscriptionResult> {
  try {
    const res = await fetch(graphUrl([creds.page_id, "subscribed_apps"], { subscribed_fields: "messages" }), {
      method: "POST",
      headers: { authorization: `Bearer ${creds.page_access_token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean };
    if (res.ok && json.success === true) return { ok: true };
    const body = graphErrorBody(json);
    return { ok: false, error: (body?.message ?? res.statusText) || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type MetaConnectErrorCode =
  | "token_invalid"
  | "page_mismatch"
  | "instagram_not_linked"
  | "instagram_mismatch"
  | "app_secret_required"
  | "meta_unavailable";

/**
 * A connect that must be refused — the message is safe to show the merchant.
 * `status`: 400 when the merchant must change the input, 502 when Meta could not be
 * asked (try again).
 */
export class MetaConnectError extends Error {
  readonly code: MetaConnectErrorCode;
  readonly status: 400 | 502;
  constructor(code: MetaConnectErrorCode, message: string, status: 400 | 502 = 400) {
    super(message);
    this.name = "MetaConnectError";
    this.code = code;
    this.status = status;
  }
}

export const META_APP_SECRET_REQUIRED_MESSAGE =
  "app_secret: required — the App Secret (App settings → Basic) of the Meta app the Page access token was generated in; Meta signs that app's webhooks with it";

/** The platform Meta app (META_APP_ID / META_APP_SECRET): the operator's app, used for Meta OAuth and /api/meta/webhook. */
export type PlatformMetaApp = { appId: string; appSecret: string };

/**
 * How a Messenger / Instagram DM row is verified (config.connected_via): "manual" — the
 * merchant's own app, its `app_secret` is stored; "platform" — the Page token was issued
 * to the platform app, deliveries are verified with META_APP_SECRET.
 */
export type MetaDmConnectedVia = "manual" | "platform";

// "An unknown error occurred" / "Service temporarily unavailable", plus the throttling codes.
const META_TRANSIENT_CODES = new Set([1, 2, ...RATE_LIMIT_CODES]);

function metaUnavailable(detail: string): MetaConnectError {
  return new MetaConnectError(
    "meta_unavailable",
    `Could not ask Meta which app issued the Page access token (${detail}). Try again in a minute.`,
    502
  );
}

/**
 * Whether the Page access token was issued to the platform app, for this Page.
 *
 * GET /debug_token?input_token=<page token>, authenticated with the platform app's
 * access token "{app-id}|{app-secret}" (server-side only; sent in the Authorization
 * header, never in the URL). Meta inspects only tokens of the calling app ("The tokens
 * must be from the same app"), so a token of any other app is refused (→ false); for
 * the platform's own tokens `data.app_id` must be META_APP_ID, `is_valid` true and the
 * Page in `profile_id` (when present) the one being connected. Throws
 * MetaConnectError("meta_unavailable", 502) when Meta cannot answer (network, 5xx,
 * throttling) rather than calling the token foreign.
 * https://developers.facebook.com/docs/graph-api/reference/debug_token/
 * https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
 */
export async function isPlatformAppPageToken(
  creds: Pick<MetaMessagingCredentials, "page_id" | "page_access_token">,
  app: PlatformMetaApp
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(graphUrl("debug_token", { input_token: creds.page_access_token }), {
      headers: { authorization: `Bearer ${app.appId}|${app.appSecret}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
    });
  } catch (err) {
    throw metaUnavailable(err instanceof Error ? err.message : String(err));
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { app_id?: unknown; is_valid?: unknown; profile_id?: unknown };
  };
  if (!res.ok) {
    const error = graphErrorBody(json);
    if (res.status >= 500 || (error?.code !== undefined && META_TRANSIENT_CODES.has(error.code))) {
      throw metaUnavailable(error?.message ?? `HTTP ${res.status}`);
    }
    return false; // another app's token (#100), or one Meta no longer accepts
  }
  const data = json.data;
  if (!data || data.is_valid !== true || idString(data.app_id) !== app.appId) return false;
  const profileId = idString(data.profile_id);
  return profileId === null || profileId === creds.page_id;
}

export type PreparedMetaIntegration = {
  credentials: MetaMessagingCredentials;
  /** Verified routing id: the Page id (meta) or the IG professional account id (instagram). */
  externalId: string;
  config: {
    connected_via: MetaDmConnectedVia;
    page_name: string | null;
    subscribed: boolean;
    subscribed_fields: string[];
    subscribe_error?: string;
  };
};

/**
 * Prove the token belongs to the Page being connected (GET /me must return
 * page_id), establish which secret will verify the Page's webhooks, resolve / check
 * the Instagram account, then subscribe the Page to `messages`. Throws
 * MetaConnectError when the connection must be refused — always before the Page is
 * subscribed.
 *
 * Meta signs a Page's webhooks with the secret of the app the Page token was issued
 * to (POST subscribed_apps subscribes exactly that app). So without the merchant's own
 * `app_secret` the only usable key is META_APP_SECRET, and only when the token belongs
 * to the platform app (`opts.platformApp`, proven with /debug_token) — otherwise the
 * connect is refused instead of saving a channel whose every delivery fails (RB-W1).
 */
export async function prepareMetaIntegration(
  kind: MetaChannel,
  input: MetaMessagingCredentials,
  opts: { platformApp?: PlatformMetaApp | null } = {}
): Promise<PreparedMetaIntegration> {
  let identity: MetaPageIdentity;
  try {
    identity = await inspectMetaPageToken(input);
  } catch (err) {
    throw new MetaConnectError(
      "token_invalid",
      `Meta rejected the Page access token: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (identity.id !== input.page_id) {
    throw new MetaConnectError(
      "page_mismatch",
      `The access token belongs to ${identity.id}, not Page ${input.page_id}. Use a Page access token for this Page.`
    );
  }

  let connectedVia: MetaDmConnectedVia = "manual";
  if (!input.app_secret) {
    const platform = opts.platformApp ?? null;
    if (!platform || !(await isPlatformAppPageToken(input, platform))) {
      throw new MetaConnectError("app_secret_required", META_APP_SECRET_REQUIRED_MESSAGE);
    }
    connectedVia = "platform";
  }

  const credentials: MetaMessagingCredentials = {
    page_id: input.page_id,
    page_access_token: input.page_access_token,
    ...(input.app_secret ? { app_secret: input.app_secret } : {}),
    ...(input.verify_token ? { verify_token: input.verify_token } : {})
  };

  let externalId = input.page_id;
  if (kind === "instagram") {
    const linked = identity.instagramAccountId;
    if (!linked) {
      throw new MetaConnectError(
        "instagram_not_linked",
        "This Facebook Page has no linked Instagram professional account."
      );
    }
    const supplied = input.ig_account_id?.trim();
    if (supplied && supplied !== linked) {
      throw new MetaConnectError(
        "instagram_mismatch",
        `Instagram account ${supplied} is not the account linked to this Page (${linked}).`
      );
    }
    credentials.ig_account_id = linked;
    externalId = linked;
  }

  const subscription = await subscribeMetaPageToMessages(credentials);
  return {
    credentials,
    externalId,
    config: {
      connected_via: connectedVia,
      page_name: identity.name,
      subscribed: subscription.ok,
      subscribed_fields: subscription.ok ? ["messages"] : [],
      ...(subscription.ok ? {} : { subscribe_error: subscription.error.slice(0, 300) })
    }
  };
}
