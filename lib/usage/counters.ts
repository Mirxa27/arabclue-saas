/**
 * Per-merchant usage quotas stored in public.merchant_usage_counters
 * (supabase/migrations/20261106007500_seo_audits_and_usage.sql).
 *
 * The table and its RPCs are service-role only: a merchant cannot read, reset or delete
 * their counters (unlike seo_content rows, which they may delete), and the in-memory rate
 * limiter's per-instance fallback is no substitute for a monthly or daily cap. A claim is
 * atomic (one INSERT … ON CONFLICT DO UPDATE … WHERE used < limit), so concurrent requests
 * cannot overshoot the limit; release gives a unit back when the paid work never happened.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import { reportError } from "@/lib/observability/error-reporter";

export type UsageMetric = "seo.generation" | "seo.audit" | "wathq.lookup";

export type UsageClaim = { allowed: boolean; used: number; limit: number; periodStart: string };

const RIYADH_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** YYYY-MM-DD of `now` in Asia/Riyadh (merchants' business day). */
export function riyadhDate(now: Date = new Date()): string {
  return RIYADH_DATE.format(now);
}

/** First day (YYYY-MM-01) of `now`'s month in Asia/Riyadh. */
export function riyadhMonthStart(now: Date = new Date()): string {
  return `${riyadhDate(now).slice(0, 7)}-01`;
}

function asClaim(data: unknown, periodStart: string, limit: number): UsageClaim {
  const row = (data ?? {}) as { allowed?: unknown; used?: unknown; limit?: unknown };
  return {
    allowed: row.allowed === true,
    used: typeof row.used === "number" ? row.used : Number(row.used ?? 0) || 0,
    limit: typeof row.limit === "number" ? row.limit : limit,
    periodStart
  };
}

/** Atomically take one unit of `metric` for the period; `allowed: false` once `limit` is reached. */
export async function claimUsage(
  sb: SupabaseClient,
  args: { merchantId: string; metric: UsageMetric; periodStart: string; limit: number }
): Promise<UsageClaim> {
  const { data, error } = await sb.rpc("claim_merchant_usage", {
    p_merchant_id: args.merchantId,
    p_metric: args.metric,
    p_period_start: args.periodStart,
    p_limit: args.limit
  });
  if (error) throw new HttpError(503, "Usage quota could not be checked — try again shortly", "usage_unavailable");
  return asClaim(data, args.periodStart, args.limit);
}

/** Give back one unit (the paid call failed). Best effort: a failure is reported, never thrown. */
export async function releaseUsage(
  sb: SupabaseClient,
  args: { merchantId: string; metric: UsageMetric; periodStart: string }
): Promise<void> {
  try {
    const { error } = await sb.rpc("release_merchant_usage", {
      p_merchant_id: args.merchantId,
      p_metric: args.metric,
      p_period_start: args.periodStart
    });
    if (error) throw new Error(`release_merchant_usage: ${error.message}`);
  } catch (err) {
    reportError(err, { merchantId: args.merchantId, extra: { metric: args.metric } });
  }
}

/** Units used so far in the period (0 when none). */
export async function readUsage(
  sb: SupabaseClient,
  args: { merchantId: string; metric: UsageMetric; periodStart: string }
): Promise<number> {
  const { data, error } = await sb
    .from("merchant_usage_counters")
    .select("used")
    .eq("merchant_id", args.merchantId)
    .eq("metric", args.metric)
    .eq("period_start", args.periodStart)
    .maybeSingle();
  assertNoDbError(error, "Load usage", { merchantId: args.merchantId, code: "db_read_failed" });
  return Number((data as { used?: number } | null)?.used ?? 0);
}
