/**
 * App-side caps on the sign-in endpoints, on top of Supabase Auth's own limits.
 *
 * Every GoTrue call is made by this server, so unless the visitor's IP is forwarded
 * (SUPABASE_SECRET_KEY, see createRouteHandlerSupabase) Supabase counts all sign-ins against
 * the server's own address — a budget one client could otherwise drain for every merchant.
 *  - per client IP: link requests (any address) and link verifications;
 *  - per address (normalised to the inbox it delivers to): link requests, so one inbox cannot
 *    be flooded by rotating clients or "+tags". The owner may be throttled for the window if
 *    someone else floods their address, but already-sent token-hash links keep working.
 * IP buckets are skipped when the client IP is unknown (TRUSTED_PROXY_HOPS=0, no proxy
 * headers): they would collapse into a single global bucket that any client could exhaust.
 */
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { clientIp, enforceRateLimit } from "@/lib/security/rate-limit";

export const SIGN_IN_LIMITS = {
  /** POST /api/auth/otp per client IP, all addresses and modes. */
  otpPerIp: { limit: 20, windowMs: 15 * 60_000 },
  /** POST /api/auth/otp per address, all clients and modes. */
  otpPerEmail: { limit: 3, windowMs: 15 * 60_000 },
  /** /auth/confirm + /auth/callback per client IP (each attempt may call GoTrue). */
  verifyPerIp: { limit: 30, windowMs: 5 * 60_000 }
} as const;

type Window = { limit: number; windowMs: number };

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The inbox an address delivers to: lower-cased, "+tag" dropped, Gmail dots and googlemail.com folded. */
export function normalizeEmailForThrottle(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** Non-reversible bucket id for an address, so addresses never appear in rate-limit keys. */
function emailBucket(email: string): string {
  return createHash("sha256").update(normalizeEmailForThrottle(email)).digest("base64url").slice(0, 24);
}

/** The 429 to return when this client IP is over `window` for `scope`; null when allowed or the IP is unknown. */
export async function limitSignInByIp(req: Request, scope: string, window: Window): Promise<NextResponse | null> {
  if (clientIp(req) === "unknown") return null;
  const result = await enforceRateLimit(req, scope, window.limit, window.windowMs);
  return result instanceof NextResponse ? result : null;
}

/** The 429 to return when `email` was sent too many sign-in links recently; null when allowed. */
export async function limitSignInByEmail(req: Request, email: string): Promise<NextResponse | null> {
  const { limit, windowMs } = SIGN_IN_LIMITS.otpPerEmail;
  const result = await enforceRateLimit(req, "auth:otp:email", limit, windowMs, { identity: emailBucket(email) });
  return result instanceof NextResponse ? result : null;
}
