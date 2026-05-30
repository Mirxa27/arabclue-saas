import { getServiceSupabase } from "@/lib/db/supabase";

export type BillingCycleResult = {
  trialsExpired: number;
  pastDuePaused: number;
};

/**
 * Enforce employee seat billing between cron ticks:
 * - trial ended without payment → past_due + paused
 * - active subscription past next_billing_at → past_due + paused
 */
export async function enforceEmployeeBillingCycle(): Promise<BillingCycleResult> {
  const sb = getServiceSupabase();
  const now = new Date().toISOString();
  let trialsExpired = 0;
  let pastDuePaused = 0;

  const { data: expiredTrials } = await sb
    .from("ai_employees")
    .select("id")
    .eq("billing_status", "trial")
    .eq("status", "active")
    .not("trial_ends_at", "is", null)
    .lte("trial_ends_at", now);

  for (const row of expiredTrials ?? []) {
    const { error } = await sb
      .from("ai_employees")
      .update({
        billing_status: "past_due",
        status: "paused",
        paused_at: now
      })
      .eq("id", row.id as string);
    if (!error) trialsExpired += 1;
  }

  const { data: overdueActive } = await sb
    .from("ai_employees")
    .select("id")
    .eq("billing_status", "active")
    .eq("status", "active")
    .not("next_billing_at", "is", null)
    .lte("next_billing_at", now);

  for (const row of overdueActive ?? []) {
    const { error } = await sb
      .from("ai_employees")
      .update({
        billing_status: "past_due",
        status: "paused",
        paused_at: now
      })
      .eq("id", row.id as string);
    if (!error) pastDuePaused += 1;
  }

  return { trialsExpired, pastDuePaused };
}
