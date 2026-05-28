import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Moyasar webhook using HMAC-SHA256 over the raw request body.
 * Configure MOYASAR_WEBHOOK_SECRET from the Moyasar dashboard webhook endpoint.
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
