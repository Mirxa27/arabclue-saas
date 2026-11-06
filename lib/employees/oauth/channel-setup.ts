/**
 * One-click OAuth → credentials the send adapters can use (SW-7).
 *
 * The token endpoints return generic OAuth tokens; the messaging adapters need provider
 * specific keys. Each messaging provider maps its exchange result here, and a row is only
 * saved `connected` when it holds everything its adapter needs (missingSendCredentials).
 * When the provider account has several candidates (several WhatsApp numbers, several Pages
 * with Instagram accounts) or none, the row is saved `disconnected` with
 * `config.setup = { state, options }` and finished with PATCH /api/employees/:id/integrations
 * (`completeOAuthChannelSetup`) — nothing is guessed.
 *
 *   slack     oauth.v2.access `access_token` (xoxb, token_type "bot") → bot_token; team id
 *             (https://api.slack.com/methods/oauth.v2.access). Request signing uses the
 *             app's SLACK_SIGNING_SECRET (lib/employees/inbound/slack.ts).
 *   gmail     tokens + the account address from userinfo → `email` (From of Gmail API sends).
 *   whatsapp  short-lived user token → long-lived (fb_exchange_token); WABA ids from
 *             /debug_token granular_scopes (whatsapp_business_management); numbers from
 *             /{waba-id}/phone_numbers; the app is subscribed to the WABA's webhooks with
 *             the employee's callback as override_callback_uri + a generated verify_token
 *             (deliveries are signed with META_APP_SECRET — accepted for connected_via
 *             'oauth' rows by lib/employees/inbound/whatsapp.ts).
 *             https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts
 *             https://developers.facebook.com/docs/whatsapp/embedded-signup/webhooks/override
 *   instagram long-lived user token; /me/accounts?fields=id,name,access_token,
 *             instagram_business_account; the chosen Page goes through the same
 *             prepareMetaIntegration proof as a manual connect (GET /me, /debug_token that the
 *             token is the platform app's → connected_via 'platform', Page subscribed to
 *             `messages`). https://developers.facebook.com/docs/messenger-platform/instagram/get-started
 */
import { randomBytes } from "crypto";
import { graphUrl } from "@/lib/meta/graph";
import { prepareMetaIntegration, MetaConnectError } from "@/lib/employees/channels/meta";
import { missingSendCredentials } from "@/lib/employees/channel-credentials";
import type { IntegrationKind } from "@/lib/employees/types";
import type { OAuthTokens } from "./providers";

export type SetupState = "choose_phone_number" | "no_whatsapp_number" | "choose_instagram_page" | "no_instagram_page";

export type SetupOption = Record<string, string | null>;

export type OAuthChannelSetup = {
  status: "connected" | "needs_setup";
  credentials: Record<string, unknown>;
  externalId: string | null;
  config: Record<string, unknown>;
  setup?: { state: SetupState; options: SetupOption[] };
};

/** Thrown when the provider accepted the login but the account cannot be used (stable code). */
export class OAuthChannelSetupError extends Error {
  readonly code: "token_exchange_failed" | "account_lookup_failed" | "not_configured";
  constructor(code: OAuthChannelSetupError["code"], message: string) {
    super(message);
    this.name = "OAuthChannelSetupError";
    this.code = code;
  }
}

const GRAPH_TIMEOUT_MS = 15_000;
const MAX_OPTIONS = 25;

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function idString(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,32}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

async function graphJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

function platformApp(): { appId: string; appSecret: string } {
  const appId = env("META_APP_ID");
  const appSecret = env("META_APP_SECRET");
  if (!appId || !appSecret) throw new OAuthChannelSetupError("not_configured", "META_APP_ID / META_APP_SECRET are not configured");
  return { appId, appSecret };
}

/** Exchange a short-lived Facebook user token for a long-lived one (≈60 days). */
export async function longLivedMetaUserToken(shortLived: string): Promise<{ access_token: string; expires_in?: number }> {
  const app = platformApp();
  const { ok, json } = await graphJson(
    graphUrl("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: app.appId,
      client_secret: app.appSecret,
      fb_exchange_token: shortLived
    })
  );
  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!ok || !token) throw new OAuthChannelSetupError("token_exchange_failed", "Meta refused the long-lived token exchange");
  return { access_token: token, ...(typeof json.expires_in === "number" ? { expires_in: json.expires_in } : {}) };
}

function newVerifyToken(): string {
  return randomBytes(24).toString("hex");
}

function siteUrl(): string | null {
  const site = env("NEXT_PUBLIC_SITE_URL");
  return site ? site.replace(/\/+$/, "") : null;
}

// ─── Slack ────────────────────────────────────────────────────────────────

export function slackSetup(tokens: OAuthTokens): OAuthChannelSetup {
  const raw = (tokens.raw ?? {}) as { team?: { id?: string; name?: string }; bot_user_id?: string; app_id?: string; token_type?: string };
  const botToken = typeof tokens.access_token === "string" && tokens.access_token.startsWith("xoxb-") ? tokens.access_token : "";
  if (!botToken) throw new OAuthChannelSetupError("token_exchange_failed", "Slack did not return a bot token");
  const teamId = typeof raw.team?.id === "string" ? raw.team.id : null;
  return {
    status: "connected",
    credentials: {
      bot_token: botToken,
      ...(teamId ? { team_id: teamId } : {}),
      ...(typeof raw.bot_user_id === "string" ? { bot_user_id: raw.bot_user_id } : {}),
      ...(typeof raw.app_id === "string" ? { app_id: raw.app_id } : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {})
    },
    externalId: teamId,
    config: {}
  };
}

// ─── Gmail ────────────────────────────────────────────────────────────────

export function gmailSetup(tokens: OAuthTokens, account: { email: string | null }): OAuthChannelSetup {
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
  return {
    status: "connected",
    credentials: {
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      ...(account.email ? { email: account.email } : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      ...(expiresAt ? { token_expires_at: expiresAt } : {})
    },
    externalId: account.email,
    config: expiresAt ? { token_expires_at: expiresAt } : {}
  };
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────

type WhatsAppNumber = { id: string; display_phone_number: string | null; verified_name: string | null; waba_id: string };

async function whatsappAccountIds(userToken: string): Promise<string[]> {
  const app = platformApp();
  const { ok, json } = await graphJson(graphUrl("debug_token", { input_token: userToken }), {
    headers: { authorization: `Bearer ${app.appId}|${app.appSecret}` }
  });
  if (!ok) throw new OAuthChannelSetupError("account_lookup_failed", "Meta could not inspect the WhatsApp token");
  const data = (json.data ?? {}) as { app_id?: unknown; is_valid?: unknown; granular_scopes?: Array<{ scope?: string; target_ids?: unknown[] }> };
  if (data.is_valid !== true || idString(data.app_id) !== app.appId) {
    throw new OAuthChannelSetupError("account_lookup_failed", "The WhatsApp token was not issued to this app");
  }
  const ids = new Set<string>();
  for (const s of data.granular_scopes ?? []) {
    if (s.scope !== "whatsapp_business_management" && s.scope !== "whatsapp_business_messaging") continue;
    for (const t of s.target_ids ?? []) {
      const id = idString(t);
      if (id) ids.add(id);
    }
  }
  return [...ids].slice(0, MAX_OPTIONS);
}

async function whatsappNumbers(userToken: string, wabaIds: string[]): Promise<WhatsAppNumber[]> {
  const out: WhatsAppNumber[] = [];
  for (const waba of wabaIds) {
    const { ok, json } = await graphJson(graphUrl([waba, "phone_numbers"], { fields: "id,display_phone_number,verified_name" }), {
      headers: { authorization: `Bearer ${userToken}` }
    });
    if (!ok) continue;
    for (const n of Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : []) {
      const id = idString(n.id);
      if (!id) continue;
      out.push({
        id,
        waba_id: waba,
        display_phone_number: typeof n.display_phone_number === "string" ? n.display_phone_number : null,
        verified_name: typeof n.verified_name === "string" ? n.verified_name : null
      });
      if (out.length >= MAX_OPTIONS) return out;
    }
  }
  return out;
}

/**
 * Subscribe the platform app to the WABA's webhooks with this employee's callback as the
 * override (Meta verifies the callback with `verify_token` — the row must already be saved).
 * Never throws.
 */
export async function subscribeWhatsAppWebhooks(args: {
  employeeId: string;
  wabaId: string;
  accessToken: string;
  verifyToken: string;
}): Promise<{ subscribed: boolean; error?: string }> {
  const site = siteUrl();
  if (!site) return { subscribed: false, error: "NEXT_PUBLIC_SITE_URL is not configured" };
  try {
    const body = new URLSearchParams({
      override_callback_uri: `${site}/api/employees/webhooks/whatsapp/${args.employeeId}`,
      verify_token: args.verifyToken
    });
    const { ok, json } = await graphJson(graphUrl([args.wabaId, "subscribed_apps"]), {
      method: "POST",
      headers: { authorization: `Bearer ${args.accessToken}`, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (ok && json.success === true) return { subscribed: true };
    const err = (json.error ?? {}) as { message?: string };
    return { subscribed: false, error: (err.message ?? "subscription failed").slice(0, 300) };
  } catch (err) {
    return { subscribed: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

function whatsappConnected(userToken: { access_token: string; expires_in?: number }, number: WhatsAppNumber, verifyToken: string): OAuthChannelSetup {
  return {
    status: "connected",
    credentials: {
      phone_number_id: number.id,
      access_token: userToken.access_token,
      waba_id: number.waba_id,
      verify_token: verifyToken,
      ...(number.display_phone_number ? { display_phone_number: number.display_phone_number } : {})
    },
    externalId: number.id,
    config: {
      ...(userToken.expires_in ? { token_expires_at: new Date(Date.now() + userToken.expires_in * 1000).toISOString() } : {}),
      ...(number.verified_name ? { verified_name: number.verified_name } : {})
    }
  };
}

export async function whatsappSetup(tokens: OAuthTokens): Promise<OAuthChannelSetup> {
  const longLived = await longLivedMetaUserToken(tokens.access_token);
  const numbers = await whatsappNumbers(longLived.access_token, await whatsappAccountIds(longLived.access_token));
  const verifyToken = newVerifyToken();
  if (numbers.length === 1) return whatsappConnected(longLived, numbers[0], verifyToken);
  const state: SetupState = numbers.length === 0 ? "no_whatsapp_number" : "choose_phone_number";
  return {
    status: "needs_setup",
    credentials: { access_token: longLived.access_token, verify_token: verifyToken },
    externalId: null,
    config: longLived.expires_in ? { token_expires_at: new Date(Date.now() + longLived.expires_in * 1000).toISOString() } : {},
    setup: { state, options: numbers.map((n) => ({ ...n })) }
  };
}

// ─── Instagram (DMs) ──────────────────────────────────────────────────────

type InstagramPage = { page_id: string; page_name: string | null; ig_account_id: string; page_access_token: string };

async function instagramPages(userToken: string): Promise<InstagramPage[]> {
  const { ok, json } = await graphJson(graphUrl("me/accounts", { fields: "id,name,access_token,instagram_business_account", limit: 50 }), {
    headers: { authorization: `Bearer ${userToken}` }
  });
  if (!ok) throw new OAuthChannelSetupError("account_lookup_failed", "Meta did not list the Facebook Pages");
  const pages: InstagramPage[] = [];
  for (const p of Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : []) {
    const pageId = idString(p.id);
    const ig = idString((p.instagram_business_account as { id?: unknown } | undefined)?.id);
    const token = typeof p.access_token === "string" ? p.access_token : "";
    if (!pageId || !ig || !token) continue;
    pages.push({ page_id: pageId, page_name: typeof p.name === "string" ? p.name : null, ig_account_id: ig, page_access_token: token });
    if (pages.length >= MAX_OPTIONS) break;
  }
  return pages;
}

async function instagramConnected(page: InstagramPage): Promise<OAuthChannelSetup> {
  let prepared;
  try {
    prepared = await prepareMetaIntegration(
      "instagram",
      { page_id: page.page_id, page_access_token: page.page_access_token, verify_token: newVerifyToken() },
      { platformApp: platformApp() }
    );
  } catch (err) {
    if (err instanceof MetaConnectError) throw new OAuthChannelSetupError("account_lookup_failed", err.message);
    throw err;
  }
  return { status: "connected", credentials: { ...prepared.credentials }, externalId: prepared.externalId, config: { ...prepared.config } };
}

export async function instagramSetup(tokens: OAuthTokens): Promise<OAuthChannelSetup> {
  const longLived = await longLivedMetaUserToken(tokens.access_token);
  const pages = await instagramPages(longLived.access_token);
  if (pages.length === 1) return instagramConnected(pages[0]);
  return {
    status: "needs_setup",
    credentials: { user_access_token: longLived.access_token },
    externalId: null,
    config: {},
    setup: {
      state: pages.length === 0 ? "no_instagram_page" : "choose_instagram_page",
      options: pages.map((p) => ({ page_id: p.page_id, page_name: p.page_name, ig_account_id: p.ig_account_id }))
    }
  };
}

// ─── dispatch ─────────────────────────────────────────────────────────────

/** Kinds whose OAuth result needs mapping before the adapter can send. */
export const OAUTH_CHANNEL_KINDS: ReadonlySet<IntegrationKind> = new Set(["slack", "gmail", "whatsapp", "instagram"]);

export async function oauthChannelSetup(
  kind: IntegrationKind,
  tokens: OAuthTokens,
  account: { email: string | null }
): Promise<OAuthChannelSetup | null> {
  switch (kind) {
    case "slack":
      return slackSetup(tokens);
    case "gmail":
      return gmailSetup(tokens, account);
    case "whatsapp":
      return whatsappSetup(tokens);
    case "instagram":
      return instagramSetup(tokens);
    default:
      return null;
  }
}

/**
 * Finish a `needs_setup` OAuth row with the merchant's choice (PATCH body credentials):
 * whatsapp `{ phone_number_id }`, instagram `{ page_id }` — each must be one of the options
 * the provider listed. Throws OAuthChannelSetupError / returns the connected setup.
 */
export async function completeOAuthChannelSetup(
  kind: IntegrationKind,
  stored: { credentials: Record<string, unknown>; config: Record<string, unknown> },
  choice: Record<string, unknown>
): Promise<OAuthChannelSetup> {
  const setup = stored.config.setup as { state?: string; options?: SetupOption[] } | undefined;
  const options = Array.isArray(setup?.options) ? setup.options : [];
  if (kind === "whatsapp") {
    const id = idString(choice.phone_number_id);
    const picked = id ? options.find((o) => o.id === id) : undefined;
    const token = typeof stored.credentials.access_token === "string" ? stored.credentials.access_token : "";
    const verifyToken = typeof stored.credentials.verify_token === "string" ? stored.credentials.verify_token : newVerifyToken();
    if (!picked || !token || !picked.waba_id) {
      throw new OAuthChannelSetupError("account_lookup_failed", "phone_number_id: choose one of the numbers listed for this WhatsApp account");
    }
    return whatsappConnected(
      { access_token: token },
      { id: picked.id as string, waba_id: picked.waba_id, display_phone_number: picked.display_phone_number ?? null, verified_name: picked.verified_name ?? null },
      verifyToken
    );
  }
  if (kind === "instagram") {
    const pageId = idString(choice.page_id);
    const userToken = typeof stored.credentials.user_access_token === "string" ? stored.credentials.user_access_token : "";
    if (!pageId || !options.some((o) => o.page_id === pageId) || !userToken) {
      throw new OAuthChannelSetupError("account_lookup_failed", "page_id: choose one of the Pages listed for this account");
    }
    const page = (await instagramPages(userToken)).find((p) => p.page_id === pageId);
    if (!page) throw new OAuthChannelSetupError("account_lookup_failed", "That Page is no longer available to this login — connect again");
    return instagramConnected(page);
  }
  throw new OAuthChannelSetupError("account_lookup_failed", "This integration has no pending setup");
}

/** Sanity check used before saving `connected`. */
export function assertSendable(kind: IntegrationKind, setup: OAuthChannelSetup): OAuthChannelSetup {
  if (setup.status !== "connected") return setup;
  const missing = missingSendCredentials(kind, setup.credentials);
  if (missing.length) throw new OAuthChannelSetupError("account_lookup_failed", `missing ${missing.join(", ")}`);
  return setup;
}
