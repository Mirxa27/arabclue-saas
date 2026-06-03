/**
 * 24/7 employee tick.
 *
 * Vercel Cron calls this every 5 minutes. We iterate over every active
 * employee, advance their queue via `tick()`, and write the heartbeat.
 *
 * Safety:
 *   • Requires CRON_SECRET header to deter abuse.
 *   • Caps the number of employees processed per run so a single bad employee
 *     can't starve the others; remaining employees pick up next tick.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { assertCronAuthorized } from "@/lib/security/cron";
import { enforceEmployeeBillingCycle } from "@/lib/employees/billing-cycle";
import { tick } from "@/lib/employees/runtime";
import type { AIEmployeeRow } from "@/lib/employees/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return run(req);
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  return run(req);
}

async function run(req: NextRequest): Promise<NextResponse> {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;

  const billing = await enforceEmployeeBillingCycle();

  const sb = getServiceSupabase();
  const { data: employees } = await sb
    .from("ai_employees")
    .select("id")
    .eq("status", "active")
    .order("hired_at", { ascending: true })
    .limit(BATCH_SIZE);

  const list = (employees ?? []) as Pick<AIEmployeeRow, "id">[];
  const results: Array<{ id: string; ok: boolean; tasksAdvanced?: number; error?: string }> = [];

  await Promise.all(
    list.map(async (e) => {
      try {
        const r = await tick(e.id);
        results.push({ id: e.id, ok: true, tasksAdvanced: r.tasksAdvanced });
      } catch (err) {
        results.push({
          id: e.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })
  );

  return NextResponse.json({
    billing,
    processed: results.length,
    results
  });
}
