/**
 * Meta (Facebook / Instagram / WhatsApp Cloud API) webhook signatures.
 *
 * Meta signs every event notification with HMAC-SHA256 of the exact request
 * bytes keyed with the app secret and sends it as
 * `X-Hub-Signature-256: sha256=<64 lowercase hex>`. The payload Meta signs is
 * the escaped-unicode JSON it sends, so the hash must be computed over the raw
 * body — re-serialising parsed JSON (e.g. Arabic text) changes the bytes.
 */
import { createHmac, timingSafeEqual } from "crypto";

export function verifyMetaSignature(
  rawBody: Uint8Array,
  header: string | null | undefined,
  appSecret: string | null | undefined
): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const hex = header.slice("sha256=".length).trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(hex, "hex");
  return provided.length === expected.length && timingSafeEqual(expected, provided);
}

/** `sha256=<hex>` header value for a body — used by tests and outbound fixtures. */
export function signMetaPayload(rawBody: Uint8Array | string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}
