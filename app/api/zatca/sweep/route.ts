/**
 * ZATCA sweep cron (vercel.json, every 10 minutes; Hostinger: call it with the header below):
 * resend documents without a ZATCA verdict, invoice waiting Salla orders, prune unclaimed ones
 * (lib/zatca/sweep.ts).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` or `x-cron-secret` — required: 503 while CRON_SECRET
 * is unset (no dev fallback for a job that signs and submits tax documents), 401 when wrong.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { isCronAuthorized } from "@/lib/security/cron";
import { zatcaRouteError } from "@/lib/zatca/route-errors";
import { runZatcaSweep } from "@/lib/zatca/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured", code: "not_configured" }, { status: 503 });
    if (!isCronAuthorized(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const summary = await runZatcaSweep(getServiceSupabase(), { budgetMs: 45_000 });
    return NextResponse.json(summary);
  } catch (err) {
    return zatcaRouteError(err, "/api/zatca/sweep");
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
