import { NextResponse, type NextRequest } from "next/server";
import { detailedHealth, publicHealth } from "@/lib/health/checks";
import { hasBearerSecret, safeEqual } from "@/lib/security/compare";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/observability/error-reporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operators (cron secret or platform-admin session) get the detailed report; never when the secret is unset. */
async function isOperator(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    if (hasBearerSecret(req, secret)) return true;
    const header = req.headers.get("x-cron-secret")?.trim();
    if (header && safeEqual(header, secret)) return true;
  }
  return isPlatformAdmin().catch(() => false);
}

export async function GET(req: NextRequest) {
  try {
    if (await isOperator(req)) {
      const report = await detailedHealth();
      return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
    }

    const limited = await enforceRateLimit(req, "health", 60, 60_000);
    if (limited instanceof NextResponse) return limited;

    const health = await publicHealth();
    return NextResponse.json(health, {
      status: health.ok ? 200 : 503,
      headers: { "cache-control": "public, max-age=30" }
    });
  } catch (err) {
    reportError(err, { route: "/api/health" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
