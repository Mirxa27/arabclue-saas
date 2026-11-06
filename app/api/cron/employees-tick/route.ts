/**
 * 24/7 employee tick.
 *
 * Called every 5 minutes (Vercel Cron / Hostinger cron). Takes the active
 * employees that were ticked least recently (never-ticked first), advances each
 * one's queue via `tick()` with bounded concurrency and a time budget, records
 * the attempt so failures rotate to the back of the queue, and prunes old
 * webhook idempotency claims.
 *
 * Safety: requires CRON_SECRET (header only).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { assertCronAuthorized } from "@/lib/security/cron";
import { enforceEmployeeBillingCycle } from "@/lib/employees/billing-cycle";
import { tick } from "@/lib/employees/runtime";
import { runTickQueue } from "@/lib/employees/tick-queue";
import { pruneWebhookEvents } from "@/lib/webhooks/idempotency";
import { handleRouteError } from "@/lib/api/route-handler";
import { reportError } from "@/lib/observability/error-reporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 50;
const CONCURRENCY = 5;
/** Stop starting new ticks after this long; leaves headroom inside maxDuration. */
const TIME_BUDGET_MS = 45_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return run(req);
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  return run(req);
}

async function run(req: NextRequest): Promise<NextResponse> {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  try {
    const billing = await enforceEmployeeBillingCycle();

    const sb = getServiceSupabase();
    const { data, error } = await sb.rpc("next_employees_to_tick", { p_limit: BATCH_SIZE });
    if (error) throw new Error(`tick queue: ${error.message}`);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

    const { results, deferred } = await runTickQueue(ids, (id) => tick(id), {
      concurrency: CONCURRENCY,
      budgetMs: TIME_BUDGET_MS
    });

    // Successful ticks write their heartbeat; record failed attempts too so they rotate.
    const failed = results.filter((r) => !r.ok).map((r) => r.id);
    if (failed.length) {
      const { error: markError } = await sb.rpc("mark_employees_ticked", { p_ids: failed });
      if (markError) reportError(new Error(`mark_employees_ticked: ${markError.message}`), { route: "cron/employees-tick" });
    }

    let pruned = 0;
    try {
      pruned = await pruneWebhookEvents(sb, 14);
    } catch (err) {
      reportError(err, { route: "cron/employees-tick" });
    }

    return NextResponse.json({
      billing,
      processed: results.length,
      deferred: deferred.length,
      failed: failed.length,
      webhookClaimsPruned: pruned,
      results
    });
  } catch (err) {
    return handleRouteError(err, { route: "cron/employees-tick" });
  }
}
