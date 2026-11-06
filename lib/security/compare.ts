/**
 * Constant-time secret comparison helpers for webhook / bearer authentication.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// Per-process key: comparing HMAC digests makes the comparison constant-time
// and independent of the inputs' lengths (no length oracle).
const COMPARE_KEY = randomBytes(32);

export function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", COMPARE_KEY).update(a, "utf8").digest();
  const db = createHmac("sha256", COMPARE_KEY).update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * True only when `secret` is configured (non-blank) AND the request carries it
 * as a bearer token. A missing secret never authorizes anything — this is what
 * the old `!== \`Bearer ${process.env.X}\`` checks got wrong ("Bearer undefined").
 */
export function hasBearerSecret(req: Request, secret: string | null | undefined): boolean {
  const expected = secret?.trim();
  if (!expected) return false;
  const provided = bearerToken(req);
  if (!provided) return false;
  return safeEqual(provided, expected);
}
