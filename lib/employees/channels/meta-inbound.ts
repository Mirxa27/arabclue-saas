/**
 * Meta (Messenger + Instagram) inbound DM webhooks for AI employees — pure helpers, no I/O.
 *
 * One per-employee callback (GET/POST /api/employees/webhooks/meta/[id]) serves both
 * webhook objects of the merchant's own Meta app: "page" (Messenger → IntegrationKind
 * "meta") and "instagram" (Instagram Direct → "instagram"). The route lives in
 * lib/employees/inbound/meta.ts. Kept out of channels/meta.ts so the module mock in
 * __tests__/employees/dispatch.test.ts stays valid.
 *
 * Meta references:
 *   https://developers.facebook.com/docs/messenger-platform/webhooks
 *   https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages
 *   https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 */
import { safeEqual } from "@/lib/security/compare";
import { verifyMetaSignature } from "@/lib/webhooks/meta-signature";
import type { MetaDmConnectedVia } from "./meta";

export { verifyMetaSignature };

/** webhook_events.provider for DM claims (global on purpose: one reply per message id). */
export const META_WEBHOOK_PROVIDER = "meta_messaging";

export type MetaKind = "meta" | "instagram";
export const META_KINDS: readonly MetaKind[] = ["meta", "instagram"];

/** "page" → Messenger ("meta"); "instagram" → Instagram Direct. Anything else is not ours. */
export function metaKindForObject(object: unknown): MetaKind | null {
  if (object === "page") return "meta";
  if (object === "instagram") return "instagram";
  return null;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * `config.connected_via` of a row whose Page token the connect proved to be issued to
 * the platform Meta app (META_APP_ID) — lib/employees/connect.ts. Server-owned: a
 * client-supplied value is dropped before the row is stored.
 */
export const META_PLATFORM_CONNECTED_VIA = "platform" satisfies MetaDmConnectedVia;

/** The parts of an ai_employee_integrations row the helpers below read. */
export type MetaIntegrationFields = {
  credentials?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
};

/**
 * The key for X-Hub-Signature-256 on this row's deliveries: its own `app_secret`;
 * META_APP_SECRET only for a row connected through the platform app (Meta signs a
 * Page's webhooks with the secret of the app the Page token was issued to); else null.
 * A bring-your-own-app row never falls back: the platform secret cannot verify what
 * the merchant's app signs (RB-W1).
 */
export function metaAppSecretFor(row: MetaIntegrationFields): string | null {
  const own = nonEmpty(row.credentials?.app_secret);
  if (own) return own;
  if (row.config?.connected_via === META_PLATFORM_CONNECTED_VIA) return nonEmpty(process.env.META_APP_SECRET);
  return null;
}

/** The integration's own verify token, else env META_WEBHOOK_VERIFY_TOKEN, else null. */
export function metaVerifyTokenFor(creds: Record<string, unknown> | null | undefined): string | null {
  return nonEmpty(creds?.verify_token) ?? nonEmpty(process.env.META_WEBHOOK_VERIFY_TOKEN);
}

/** The id Meta puts in entry[].id / recipient.id: the Page id (meta) or IG professional account id. */
export function metaAccountIdFor(kind: MetaKind, creds: Record<string, unknown> | null | undefined): string | null {
  const raw = kind === "meta" ? creds?.page_id : creds?.ig_account_id;
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return String(raw);
  return nonEmpty(raw);
}

export type MetaDmEndpoint = {
  kind: MetaKind;
  /** The Page whose Send API node replies go through (both kinds). */
  pageId: string;
  /** What Meta puts in entry[].id: the Page id (meta) or the IG professional account id (instagram). */
  accountId: string;
};

/**
 * The DM endpoint a Messenger / Instagram row is set up for, or null when the row has
 * no DM credentials: a Page access token, the Page id and the kind's account id. The
 * Instagram row the employee OAuth flow writes for content publishing (a user token,
 * no Page or IG ids) is not a DM endpoint, so it never takes part in verifying or
 * routing DM deliveries (RB-W2).
 */
export function metaDmEndpoint(row: { kind: string; credentials?: Record<string, unknown> | null }): MetaDmEndpoint | null {
  const kind: MetaKind | null = row.kind === "meta" || row.kind === "instagram" ? row.kind : null;
  if (!kind || !nonEmpty(row.credentials?.page_access_token)) return null;
  const pageId = metaAccountIdFor("meta", row.credentials);
  const accountId = metaAccountIdFor(kind, row.credentials);
  return pageId && accountId ? { kind, pageId, accountId } : null;
}

const SIGNATURE_HEADER_RE = /^sha256=[0-9a-f]{64}$/i;

/** Whether X-Hub-Signature-256 has the shape Meta sends (`sha256=<64 hex>`), whatever key made it. */
export function isMetaSignatureHeader(header: string | null | undefined): boolean {
  return typeof header === "string" && SIGNATURE_HEADER_RE.test(header);
}

/**
 * The kind an UNVERIFIED body says it is for (its top-level `object`), or null. Only
 * used to choose which channel a refused delivery is noted on — never to route,
 * store or answer anything.
 */
export function claimedMetaKind(raw: Uint8Array): MetaKind | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return metaKindForObject((parsed as { object?: unknown }).object);
  } catch {
    return null;
  }
}

export function metaWebhookEventId(kind: MetaKind, mid: string): string {
  return `${kind}:${mid}`;
}

// Meta's hub.challenge is an integer; anything outside this charset is not echoed back.
const CHALLENGE_RE = /^[A-Za-z0-9._-]{1,256}$/;

/**
 * The hub.challenge to echo for a subscription handshake, or null (→ 403).
 * Requires mode "subscribe", a well-formed challenge and a verify token equal
 * (constant-time) to one of the expected tokens.
 */
export function resolveMetaVerifyChallenge(params: URLSearchParams, expectedTokens: ReadonlyArray<string | null | undefined>): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  const challenge = params.get("hub.challenge") ?? "";
  if (!CHALLENGE_RE.test(challenge)) return null;
  const token = params.get("hub.verify_token");
  if (!token) return null;
  let matched = false;
  for (const expected of expectedTokens) {
    if (expected && safeEqual(token, expected)) matched = true;
  }
  return matched ? challenge : null;
}

// ─── Payload parsing ───────────────────────────────────────────────────────

export type MetaInboundMessage = {
  kind: MetaKind;
  accountId: string;
  /** PSID (Messenger) or IGSID (Instagram) — the reply recipient. */
  senderId: string;
  mid: string;
  text: string;
  /** Milliseconds since the epoch. */
  timestamp: number;
  hasAttachments: boolean;
  replyToMid?: string;
};

export type MetaSkipReason =
  | "malformed"
  | "foreign_account"
  | "non_message"
  | "echo"
  | "self"
  | "recipient_mismatch"
  | "no_mid"
  | "deleted"
  | "unsupported"
  | "attachment_only"
  | "empty"
  | "stale";

export type MetaParseResult = {
  accepted: MetaInboundMessage[];
  skipped: Partial<Record<MetaSkipReason, number>>;
};

export const META_DEFAULT_MAX_AGE_MS = 23 * 60 * 60 * 1000; // inside Messenger's 24 h standard window
export const META_DEFAULT_MAX_TEXT_CHARS = 4000;

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  // Page / IG ids can exceed Number.MAX_SAFE_INTEGER — only exact integers are stringified.
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function capText(text: string, max: number): string {
  const cps = Array.from(text);
  return cps.length > max ? cps.slice(0, max).join("") : text;
}

/**
 * Normalise a Messenger / Instagram webhook delivery for one connected account.
 * Reads only entry[].messaging (never entry.changes — the social pipeline's — or
 * entry.standby — another app owns those threads). Returns the text DMs worth an
 * AI reply, oldest first, and counts of everything skipped.
 */
export function parseMetaMessagingWebhook(
  payload: unknown,
  opts: { kind: MetaKind; accountId: string; nowMs: number; maxAgeMs?: number; maxTextChars?: number }
): MetaParseResult {
  const maxAgeMs = opts.maxAgeMs ?? META_DEFAULT_MAX_AGE_MS;
  const maxTextChars = opts.maxTextChars ?? META_DEFAULT_MAX_TEXT_CHARS;
  const accepted: MetaInboundMessage[] = [];
  const skipped: Partial<Record<MetaSkipReason, number>> = {};
  const skip = (reason: MetaSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? (root.entry as unknown[]) : [];
  for (const rawEntry of entries) {
    const entry = asRecord(rawEntry);
    if (!entry) {
      skip("malformed");
      continue;
    }
    const messaging = Array.isArray(entry.messaging) ? (entry.messaging as unknown[]) : [];
    const entryId = idOf(entry.id);
    if (entryId !== opts.accountId) {
      // One app can feed several Pages / IG accounts into this callback; only ours is answered.
      for (let i = 0; i < messaging.length; i++) skip("foreign_account");
      continue;
    }
    const entryTime = typeof entry.time === "number" ? entry.time : undefined;

    for (const rawEvent of messaging) {
      const event = asRecord(rawEvent);
      if (!event) {
        skip("malformed");
        continue;
      }
      const message = asRecord(event.message);
      if (!message) {
        skip("non_message"); // delivery / read receipts, reactions, postbacks, referrals, edits
        continue;
      }
      if (message.is_echo === true) {
        skip("echo"); // our own (or the Page inbox's) outbound message — never answer it
        continue;
      }
      const senderId = idOf(asRecord(event.sender)?.id);
      const recipientId = idOf(asRecord(event.recipient)?.id);
      if (senderId && senderId === opts.accountId) {
        skip("self");
        continue;
      }
      if (recipientId !== opts.accountId) {
        skip("recipient_mismatch");
        continue;
      }
      const mid = typeof message.mid === "string" ? message.mid : "";
      if (!senderId || !mid) {
        skip("no_mid");
        continue;
      }
      if (message.is_deleted === true) {
        skip("deleted");
        continue;
      }
      if (message.is_unsupported === true) {
        skip("unsupported");
        continue;
      }
      const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        // Images, audio, stickers, shares… are not sent to the model: a placeholder
        // like "[image]" invites invented answers.
        skip(hasAttachments ? "attachment_only" : "empty");
        continue;
      }
      const timestamp =
        typeof event.timestamp === "number" ? event.timestamp : entryTime !== undefined ? entryTime : opts.nowMs;
      if (opts.nowMs - timestamp > maxAgeMs) {
        skip("stale"); // outside the window a RESPONSE message may be sent in
        continue;
      }
      const replyTo = asRecord(message.reply_to);
      accepted.push({
        kind: opts.kind,
        accountId: opts.accountId,
        senderId,
        mid,
        text: capText(text, maxTextChars),
        timestamp,
        hasAttachments,
        ...(typeof replyTo?.mid === "string" ? { replyToMid: replyTo.mid } : {})
      });
    }
  }

  accepted.sort((a, b) => a.timestamp - b.timestamp);
  return { accepted, skipped };
}
