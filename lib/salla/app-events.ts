/**
 * Salla app lifecycle webhooks (docs.salla.dev/doc-421413) and the events log for Salla deliveries.
 *
 * app.store.authorize is how Easy Mode installs deliver tokens: they are encrypted and either
 * replace the tokens of the merchant that owns the store, or are parked in salla_installs until the
 * store owner claims them from a signed-in arabclue session (lib/salla/connect.ts). Tokens never
 * reach the events log: every payload written there goes through stripSallaSecrets first.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { reportError } from "@/lib/observability/error-reporter";
import { encryptSecret } from "@/lib/crypto/secrets";
import {
  fetchSallaUserInfo,
  sallaExpiryToDate,
  SallaApiError,
  type SallaStoreIdentity,
  type SallaWebhookEvent
} from "@/lib/salla/oauth";
import { markSallaStoreUninstalled, recordSallaAuthorization, type SallaAuthorizationOutcome } from "@/lib/salla/connect";
import { SallaAppStoreAuthorizeEventSchema } from "@/lib/types/salla";

/** Keys that hold credentials in Salla payloads (token pairs, secrets). Removed before logging. */
const SECRET_KEY = /^(access_token|refresh_token|id_token|token|client_secret|secret|password|authorization)$/i;
const MAX_DEPTH = 32;

/** Deep copy of a webhook payload without credential fields. */
export function stripSallaSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => stripSallaSecrets(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = stripSallaSecrets(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Append to the events log (service role). Throws so the delivery is retried when it fails. */
export async function logSallaEvent(sb: SupabaseClient, kind: string, merchant: string, payload: unknown): Promise<void> {
  const { error } = await sb.from("events").insert({ kind, merchant, payload: stripSallaSecrets(payload) });
  if (error) throw new Error(`events insert failed (${kind}): ${error.message}`);
}

/** user/info failures worth a redelivery: network errors, timeouts, 5xx and rate limits. */
function isTransient(err: unknown): boolean {
  if (err instanceof SallaApiError) return err.status >= 500 || err.status === 429;
  return !(err instanceof ZodError);
}

export type AppStoreAuthorizeResult = SallaAuthorizationOutcome | { outcome: "invalid_payload" };

export async function handleAppStoreAuthorize(sb: SupabaseClient, evt: SallaWebhookEvent): Promise<AppStoreAuthorizeResult> {
  const storeId = String(evt.merchant);
  const parsed = SallaAppStoreAuthorizeEventSchema.safeParse(evt);
  if (!parsed.success) {
    reportError(new Error("Salla app.store.authorize payload did not match the documented shape"), {
      extra: { store: storeId, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }
    });
    await logSallaEvent(sb, "salla.app.store.authorize.invalid", storeId, { event: evt.event, created_at: evt.created_at });
    return { outcome: "invalid_payload" };
  }

  const { access_token, refresh_token, expires, scope } = parsed.data.data;
  const now = Date.now();
  const tokens = {
    accessToken: encryptSecret(access_token),
    refreshToken: refresh_token ? encryptSecret(refresh_token) : null,
    expiresAt: sallaExpiryToDate(expires, now).toISOString()
  };

  // Who installed it: needed only to let the store owner claim an unlinked install.
  let identity: SallaStoreIdentity | null = null;
  let identityError: unknown = null;
  try {
    identity = await fetchSallaUserInfo(access_token);
    if (identity.storeId !== storeId) {
      reportError(new Error("Salla user/info names a different store than the webhook"), {
        extra: { webhookStore: storeId, userInfoStore: identity.storeId }
      });
      identity = null;
    }
  } catch (err) {
    identityError = err;
  }

  const result = await recordSallaAuthorization(sb, { storeId, tokens, scope: scope ?? null, identity });
  await logSallaEvent(sb, "salla.app.store.authorize", storeId, {
    outcome: result.outcome,
    scope: scope ?? null,
    expires_at: tokens.expiresAt,
    has_refresh_token: Boolean(refresh_token),
    installer_role: identity?.userRole ?? null,
    installer_resolved: Boolean(identity)
  });

  if (result.outcome === "pending_saved" && !identity && identityError && isTransient(identityError)) {
    // The tokens are stored; fail this delivery so Salla's redelivery (~5 min) can resolve who
    // installed the app — without it the owner cannot claim the install by email.
    throw new Error(
      `Salla user/info unavailable for store ${storeId}: ${identityError instanceof Error ? identityError.message : "unknown error"}`
    );
  }
  if (identityError) {
    reportError(identityError, { extra: { step: "salla user/info", store: storeId, outcome: result.outcome } });
  }
  return result;
}

export async function handleAppUninstalled(sb: SupabaseClient, evt: SallaWebhookEvent): Promise<void> {
  const storeId = String(evt.merchant);
  await markSallaStoreUninstalled(sb, storeId);
  await logSallaEvent(sb, "salla.uninstalled", storeId, evt);
}
