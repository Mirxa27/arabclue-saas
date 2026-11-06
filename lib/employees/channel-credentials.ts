/**
 * Stored integration credentials → the shape each send adapter reads (SW-7).
 *
 * Manual connects store the adapter's own keys. One-click OAuth rows written before the
 * OAuth flow mapped tokens per provider hold the generic `{ access_token, refresh_token,
 * token_type, expires_in, scope, external_label }` — credentials are encrypted at rest, so
 * they cannot be backfilled in SQL; they are mapped here at read time instead:
 *   slack  access_token (xoxb bot token from oauth.v2.access) → bot_token
 *   gmail  external_label (the userinfo email) → email; config.token_expires_at → token_expires_at
 * Rows that cannot be mapped (e.g. an old WhatsApp OAuth row without a phone number id) are
 * left alone: the adapter refuses them with a precise "… missing" error, and
 * `missingSendCredentials` lets connect/OAuth refuse to call such a row connected.
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "./credentials";
import type { IntegrationKind } from "./types";

type StoredIntegration = {
  id?: string;
  employee_id?: string;
  kind: IntegrationKind;
  credentials?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
};

const EMAIL_RE = /^[^\s@<>()",;:\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Credentials as the adapter for `kind` reads them (already-decrypted input). */
export function adapterCredentials(row: StoredIntegration): Record<string, unknown> {
  const creds: Record<string, unknown> = { ...(row.credentials ?? {}) };
  const config = row.config ?? {};
  switch (row.kind) {
    case "slack": {
      const access = str(creds.access_token);
      if (!str(creds.bot_token) && access?.startsWith("xoxb-")) creds.bot_token = access;
      break;
    }
    case "gmail": {
      const label = str(creds.external_label);
      if (!str(creds.email) && label && EMAIL_RE.test(label)) creds.email = label;
      const expires = str(config.token_expires_at);
      if (!str(creds.token_expires_at) && expires) creds.token_expires_at = expires;
      break;
    }
    default:
      break;
  }
  return creds;
}

/** Keys the send adapter for `kind` cannot work without, that `creds` lacks (empty = sendable). */
export function missingSendCredentials(kind: IntegrationKind, creds: Record<string, unknown>): string[] {
  const has = (k: string) => Boolean(str(creds[k]));
  const need = (...keys: string[]) => keys.filter((k) => !has(k));
  switch (kind) {
    case "whatsapp":
      return need("phone_number_id", "access_token");
    case "telegram":
      return need("bot_token");
    case "slack":
      return need("bot_token");
    case "email":
      return need("api_key", "from");
    case "gmail":
      return has("access_token") || has("refresh_token") ? [] : ["access_token"];
    case "twilio_sms":
      return [...need("account_sid", "auth_token"), ...(has("from") || has("messaging_service_sid") ? [] : ["from"])];
    case "webhook":
      return need("url");
    case "meta":
      return need("page_id", "page_access_token");
    case "instagram":
      return need("page_id", "page_access_token", "ig_account_id");
    default:
      return [];
  }
}

/**
 * Merge refreshed provider fields (e.g. a new Google access token) into an integration's
 * credentials and store them encrypted (service role). `current` may be the stored
 * (encrypted envelope) or the decrypted object. Never throws — a failed save only means the
 * next send refreshes again.
 */
export async function persistRefreshedCredentials(
  integrationId: string,
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    const next = { ...decryptIntegrationCredentials(current ?? {}), ...patch };
    const sb = getServiceSupabase();
    await sb
      .from("ai_employee_integrations")
      .update({ credentials: encryptIntegrationCredentials(next) })
      .eq("id", integrationId);
  } catch {
    // best effort
  }
}
