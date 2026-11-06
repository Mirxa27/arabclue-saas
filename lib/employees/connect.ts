/**
 * Server-side preparation of a manual channel connect
 * (POST /api/employees/:id/integrations) before it is stored.
 *
 *   meta / instagram  credentials validated per kind; the Page token must belong to the
 *                     Page (GET /me), the IG account is resolved from the Page, the Page
 *                     is subscribed to `messages`; external_id is the verified id.
 *                     `app_secret` (the merchant app's, which signs its webhooks) is
 *                     required unless /debug_token proves the Page token was issued to
 *                     the platform app → connected_via 'platform', verified with
 *                     META_APP_SECRET (RB-W1).
 *   whatsapp          validated; `app_secret` (the Meta app secret that signs webhooks)
 *                     accepted and stored encrypted.
 *   telegram          webhook registered at NEXT_PUBLIC_SITE_URL with a server-generated
 *                     256-bit secret (F29).
 *   other kinds       stored as before.
 * Config keys the server owns (connected_via, error, …) are never taken from the client.
 */
import { randomBytes } from "crypto";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { formatZodIssues } from "@/lib/api/route-handler";
import {
  META_APP_SECRET_REQUIRED_MESSAGE,
  MetaConnectError,
  prepareMetaIntegration,
  type PlatformMetaApp
} from "@/lib/employees/channels/meta";
import { registerTelegramWebhook } from "@/lib/employees/channels/telegram";
import type { IntegrationKind } from "@/lib/employees/types";

/** Written only by the server (OAuth callback, connect checks, send-failure handling). */
export const SERVER_OWNED_CONFIG_KEYS = [
  "connected_via",
  "error",
  "page_name",
  "subscribed",
  "subscribed_fields",
  "subscribe_error",
  "token_expires_at"
] as const;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const numericId = (label: string) =>
  z.string().trim().regex(/^\d{1,32}$/, `${label} must be the numeric id from Meta`);

/** Messenger / Instagram DM credentials (the merchant's own Meta app). */
export const MetaConnectCredentialsSchema = z.object({
  page_id: numericId("page_id"),
  page_access_token: z.string().trim().min(20, "page_access_token looks too short").max(2048),
  app_secret: z.preprocess(blankToUndefined, z.string().trim().min(16, "app_secret must be at least 16 characters").max(256).optional()),
  verify_token: z.string().trim().min(16, "verify_token must be at least 16 characters").max(256),
  ig_account_id: z.preprocess(blankToUndefined, numericId("ig_account_id").optional())
});

export const WhatsAppConnectCredentialsSchema = z.object({
  phone_number_id: numericId("phone_number_id"),
  access_token: z.string().trim().min(20, "access_token looks too short").max(2048),
  verify_token: z.preprocess(blankToUndefined, z.string().trim().min(1).max(256).optional()),
  app_secret: z.preprocess(blankToUndefined, z.string().trim().min(16, "app_secret must be at least 16 characters").max(256).optional())
});

export const TelegramConnectCredentialsSchema = z.object({
  bot_token: z.string().trim().min(1, "Telegram bot_token required").max(256),
  bot_username: z.preprocess(blankToUndefined, z.string().trim().max(64).optional())
});

function parseCredentials<T extends z.ZodType>(schema: T, credentials: Record<string, unknown>): z.infer<T> {
  const parsed = schema.safeParse(credentials);
  if (!parsed.success) throw new HttpError(400, formatZodIssues(parsed.error), "invalid_credentials");
  return parsed.data;
}

/** The public base URL for webhooks registered with providers (F29: no hard-coded fallback). */
export function webhookBaseUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) {
    throw new HttpError(503, "NEXT_PUBLIC_SITE_URL is not configured — cannot register the webhook", "site_url_missing");
  }
  return site.replace(/\/+$/, "");
}

export function metaWebhookUrl(employeeId: string): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return site ? `${site.replace(/\/+$/, "")}/api/employees/webhooks/meta/${employeeId}` : null;
}

export type ConnectRequest = {
  kind: IntegrationKind;
  external_id?: string | null;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
};

export type PreparedConnect = {
  external_id: string | null;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
};

function clientConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const key of SERVER_OWNED_CONFIG_KEYS) delete out[key];
  return out;
}

/** Credentials a Messenger / Instagram DM connect writes — replaced as a whole on every connect. */
const META_DM_CREDENTIAL_KEYS = ["page_id", "page_access_token", "ig_account_id", "app_secret", "verify_token"] as const;

/** The platform Meta app, when META_APP_ID and META_APP_SECRET are both configured. */
function platformMetaApp(): PlatformMetaApp | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

export async function prepareIntegrationConnect(
  employeeId: string,
  body: ConnectRequest,
  opts: { existingCredentials?: Record<string, unknown> } = {}
): Promise<PreparedConnect> {
  const config = { ...clientConfig(body.config), connected_via: "manual" };

  if (body.kind === "meta" || body.kind === "instagram") {
    const creds = parseCredentials(MetaConnectCredentialsSchema, body.credentials);
    // Without the merchant app's secret the only possible key is META_APP_SECRET, and only
    // for a Page token of the platform app (checked with Meta in prepareMetaIntegration).
    const platformApp = creds.app_secret ? null : platformMetaApp();
    if (!creds.app_secret && !platformApp) {
      throw new HttpError(400, META_APP_SECRET_REQUIRED_MESSAGE, "invalid_credentials");
    }
    let prepared;
    try {
      prepared = await prepareMetaIntegration(body.kind, creds, { platformApp });
    } catch (err) {
      if (err instanceof MetaConnectError) throw new HttpError(err.status, err.message, err.code);
      throw err;
    }
    // An OAuth-connected Instagram row (content publishing) keeps its tokens: add the DM fields to
    // it. An earlier connect's DM fields never survive — a stale app_secret would outrank
    // META_APP_SECRET on a row reconnected through the platform app.
    const base: Record<string, unknown> = body.kind === "instagram" ? { ...opts.existingCredentials } : {};
    for (const key of META_DM_CREDENTIAL_KEYS) delete base[key];
    return {
      external_id: prepared.externalId,
      credentials: { ...base, ...prepared.credentials },
      config: { ...config, ...prepared.config }
    };
  }

  if (body.kind === "whatsapp") {
    const creds = parseCredentials(WhatsAppConnectCredentialsSchema, body.credentials);
    return { external_id: body.external_id ?? null, credentials: creds, config };
  }

  if (body.kind === "telegram") {
    const creds = parseCredentials(TelegramConnectCredentialsSchema, body.credentials);
    const webhookUrl = `${webhookBaseUrl()}/api/employees/webhooks/telegram/${employeeId}`;
    // 256-bit secret; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token ([A-Za-z0-9_-], ≤ 256).
    const secret = randomBytes(32).toString("hex");
    await registerTelegramWebhook({ bot_token: creds.bot_token, webhook_secret: secret }, webhookUrl, secret);
    return {
      external_id: body.external_id ?? null,
      credentials: { ...creds, webhook_secret: secret },
      config
    };
  }

  return { external_id: body.external_id ?? null, credentials: body.credentials, config };
}
