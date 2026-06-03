/**
 * Shared authorization for cron / scheduled routes.
 *
 * Accepts the secret only from request headers — either
 * `Authorization: Bearer <secret>` (what Vercel Cron sends when CRON_SECRET is
 * set) or `x-cron-secret: <secret>`. The query string is intentionally NOT
 * consulted: secrets in URLs leak into access logs, referrers, and proxies.
 *
 * Comparison is constant-time. When CRON_SECRET is unset the call is allowed —
 * this is a local-dev affordance; production must set CRON_SECRET.
 */
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function isCronAuthorized(req: NextRequest, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return true; // dev only — no secret configured
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer && safeEqual(bearer, secret)) return true;
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret && safeEqual(headerSecret, secret)) return true;
  return false;
}

/** Returns a 401 response when unauthorized, or null to proceed. */
export function assertCronAuthorized(req: NextRequest): NextResponse | null {
  if (isCronAuthorized(req)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
