/**
 * Shared authorization for cron / scheduled routes.
 *
 * Accepts the secret only from request headers — either
 * `Authorization: Bearer <secret>` (what Vercel Cron sends when CRON_SECRET is
 * set) or `x-cron-secret: <secret>`. The query string is intentionally NOT
 * consulted: secrets in URLs leak into access logs, referrers, and proxies.
 *
 * Comparison is constant-time. Fails CLOSED when CRON_SECRET is unset: the
 * cron routes publish posts, run AI employees and enforce billing, so a deploy
 * that forgot the secret must not expose them to anyone. The only exception is
 * `next dev` (NODE_ENV=development), where an unset secret is allowed for local
 * convenience.
 */
import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/security/compare";

export type CronAuthorization = "ok" | "unauthorized" | "not_configured";

/** An unset CRON_SECRET is tolerated only in `next dev`. */
function unsetSecretAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

export function cronAuthorization(
  req: NextRequest,
  secret: string | undefined = process.env.CRON_SECRET
): CronAuthorization {
  const expected = secret?.trim();
  if (!expected) return unsetSecretAllowed() ? "ok" : "not_configured";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer && safeEqual(bearer, expected)) return "ok";
  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret && safeEqual(headerSecret, expected)) return "ok";
  return "unauthorized";
}

export function isCronAuthorized(req: NextRequest, secret: string | undefined = process.env.CRON_SECRET): boolean {
  return cronAuthorization(req, secret) === "ok";
}

/** 503 when CRON_SECRET is not configured, 401 when the caller's secret is wrong, null to proceed. */
export function assertCronAuthorized(req: NextRequest): NextResponse | null {
  const result = cronAuthorization(req);
  if (result === "ok") return null;
  if (result === "not_configured") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured", code: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}
