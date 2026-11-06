import { getServiceSupabase } from "@/lib/db/supabase";

export type BillingCycleResult = {
  trialsExpired: number;
  pastDuePaused: number;
  /** Active employees whose seat was already past_due / canceled (e.g. resumed before F10). */
  unpaidPaused: number;
};

/**
 * Enforce employee seat billing between cron ticks:
 * - trial ended without payment → past_due + paused
 * - active subscription past next_billing_at → past_due + paused
 * - status 'active' while billing is past_due / canceled → paused (F10: a row resumed
 *   without paying is caught on the next run instead of working for free)
 * Every update is conditional on the state it was selected in, so a payment confirmed
 * between the select and the update is not overwritten.
 */
export async function enforceEmployeeBillingCycle(): Promise<BillingCycleResult> {
  const sb = getServiceSupabase();
  const now = new Date().toISOString();
  let trialsExpired = 0;
  let pastDuePaused = 0;
  let unpaidPaused = 0;

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
      .eq("id", row.id as string)
      .eq("billing_status", "trial")
      .lte("trial_ends_at", now);
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
      .eq("id", row.id as string)
      .eq("billing_status", "active")
      .lte("next_billing_at", now);
    if (!error) pastDuePaused += 1;
  }

  const { data: unpaidActive } = await sb
    .from("ai_employees")
    .select("id")
    .in("billing_status", ["past_due", "canceled"])
    .eq("status", "active");

  for (const row of unpaidActive ?? []) {
    const { error } = await sb
      .from("ai_employees")
      .update({ status: "paused", paused_at: now })
      .eq("id", row.id as string)
      .in("billing_status", ["past_due", "canceled"])
      .eq("status", "active");
    if (!error) unpaidPaused += 1;
  }

  return { trialsExpired, pastDuePaused, unpaidPaused };
}
