import { createHmac, timingSafeEqual } from "crypto";
import { safeEqual } from "@/lib/security/compare";

/**
 * Moyasar webhook authentication.
 *
 * Moyasar does not sign webhook requests. Each webhook object carries the
 * `secret_token` configured on the endpoint ("The endpoint's secret is assigned by
 * the consumer to secure the webhook" —
 * https://docs.moyasar.com/api/other/webhooks/webhook-reference), so authenticity is
 * that field equal to MOYASAR_WEBHOOK_SECRET, compared in constant time, checked
 * before the event schema runs.
 */

/** Real deliveries are ~2 KB; the cap is applied while the body streams in. */
export const MOYASAR_WEBHOOK_MAX_BYTES = 256 * 1024;

/** Events that can activate a plan / employee seat; everything else is acknowledged and ignored. */
export const MOYASAR_ACTIVATION_EVENTS: ReadonlySet<string> = new Set(["payment_paid", "payment_captured"]);

/** MOYASAR_WEBHOOK_SECRET, or null when unset/blank (the webhook then refuses everything: 503). */
export function moyasarWebhookSecret(): string | null {
  return process.env.MOYASAR_WEBHOOK_SECRET?.trim() || null;
}

/** True when the parsed body's `secret_token` equals `secret` (constant time). */
export function hasValidMoyasarSecretToken(payload: unknown, secret: string): boolean {
  if (!secret || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const token = (payload as { secret_token?: unknown }).secret_token;
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return false;
  return safeEqual(token, secret);
}

/**
 * HMAC-SHA256 over the raw body.
 * @deprecated Moyasar sends no signature header — authenticate with
 * hasValidMoyasarSecretToken. Kept only for callers that sign their own relays.
 */
export function verifyMoyasarWebhook(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.trim().toLowerCase();
  const normalized = expected.toLowerCase();

  try {
    const a = Buffer.from(normalized, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
