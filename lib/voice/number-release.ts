/**
 * Releasing Twilio numbers a merchant no longer uses (SW-22).
 *
 * Every number is bought on the platform's Twilio account, so a number that outlives its
 * merchant is rent paid forever. A number leaves a merchant in three ways:
 *   - account deletion (eraseMerchantData → releaseVoiceNumberForErasure, before any row goes);
 *   - plan lapse: voice no longer included / subscription not active for RELEASE_GRACE_DAYS
 *     (the call path already declines such calls at once — lib/voice/entitlement.ts);
 *   - Salla uninstall / disconnect not undone within RELEASE_GRACE_DAYS (reconnecting clears
 *     merchants.uninstalled_at).
 * In each case voice_queue_number_release() moves the SID into public.voice_number_releases (no
 * merchant key: erasure cannot delete it) and clears the routing columns in one locked step; the
 * release is tried at once and, on failure, retried by the employees-tick cron with backoff.
 * Failures are reported every attempt and the queue keeps the SID until Twilio confirms.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import { reportError } from "@/lib/observability/error-reporter";
import type { Merchant } from "@/lib/types/database";
import { getTwilioConfig, releaseVoiceNumber, type TwilioConfig } from "@/lib/voice/twilio";
import { PROVISIONING_STALE_SECONDS } from "@/lib/voice/twilio-provisioning";

const ROUTE = "voice/number-release";

export const RELEASE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;
/** First retry after 5 minutes, doubling, at most every 12 hours. */
export const RELEASE_BACKOFF_BASE_MS = 5 * 60_000;
export const RELEASE_BACKOFF_MAX_MS = 12 * 60 * 60_000;
const DRAIN_BATCH = 10;
const SWEEP_BATCH = 500;

export type ReleaseReason = "account_deleted" | "plan_lapsed" | "store_uninstalled" | "unrecorded_purchase";

export type NumberReleaseDeps = {
  release: (cfg: TwilioConfig, incomingSid: string) => Promise<void>;
  twilio: () => TwilioConfig | null;
  now: () => Date;
};

export const DEFAULT_RELEASE_DEPS: NumberReleaseDeps = {
  release: releaseVoiceNumber,
  twilio: getTwilioConfig,
  now: () => new Date()
};

type QueueOutcome =
  | { outcome: "queued"; release_id: string; twilio_sid: string; phone_number: string | null }
  | { outcome: "in_progress" }
  | { outcome: "none" };

type ReleaseRow = { id: string; twilio_sid: string; attempts: number };

export function releaseBackoffMs(attempts: number): number {
  return Math.min(RELEASE_BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), RELEASE_BACKOFF_MAX_MS);
}

/** Atomically move the merchant's number into the release queue (voice_queue_number_release). */
export async function queueVoiceNumberRelease(
  sb: SupabaseClient,
  merchantId: string,
  reason: Exclude<ReleaseReason, "unrecorded_purchase">
): Promise<QueueOutcome> {
  const { data, error } = await sb.rpc("voice_queue_number_release", {
    p_merchant_id: merchantId,
    p_reason: reason,
    p_stale_seconds: PROVISIONING_STALE_SECONDS
  });
  if (error) throw new Error(`voice_queue_number_release failed: ${error.message}`);
  const result = data as QueueOutcome | null;
  if (result?.outcome === "queued" || result?.outcome === "in_progress" || result?.outcome === "none") return result;
  throw new Error(`voice_queue_number_release returned ${JSON.stringify(data)}`);
}

/** Queue a number nobody has a voice_configs row for (a purchase that could not be recorded). */
export async function queueUnrecordedPurchase(
  sb: SupabaseClient,
  sid: string,
  phoneNumber: string | null
): Promise<ReleaseRow | null> {
  const { data, error } = await sb
    .from("voice_number_releases")
    .upsert({ twilio_sid: sid, phone_number: phoneNumber, reason: "unrecorded_purchase" }, { onConflict: "twilio_sid" })
    .select("id, twilio_sid, attempts")
    .single();
  if (error || !data) {
    // Last resort: the operator must release it by hand — make that impossible to miss.
    reportError(new Error(`could not queue unrecorded Twilio number ${sid} for release: ${error?.message ?? "no row"}`), {
      route: ROUTE,
      extra: { sid }
    });
    return null;
  }
  return data as ReleaseRow;
}

/** One release attempt for a queued SID; records the outcome on the queue row. */
export async function attemptVoiceNumberRelease(
  sb: SupabaseClient,
  row: ReleaseRow,
  deps: NumberReleaseDeps = DEFAULT_RELEASE_DEPS
): Promise<"released" | "failed"> {
  const now = deps.now();
  const attempts = (row.attempts ?? 0) + 1;
  const twilio = deps.twilio();
  try {
    if (!twilio) throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)");
    await deps.release(twilio, row.twilio_sid);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    reportError(err, { route: ROUTE, extra: { releaseId: row.id, sid: row.twilio_sid, attempts } });
    const { error } = await sb
      .from("voice_number_releases")
      .update({
        attempts,
        last_error: message,
        next_attempt_at: new Date(now.getTime() + releaseBackoffMs(attempts)).toISOString()
      })
      .eq("id", row.id);
    if (error) reportError(new Error(`record release failure: ${error.message}`), { route: ROUTE, extra: { releaseId: row.id } });
    return "failed";
  }

  const { error } = await sb
    .from("voice_number_releases")
    .update({ status: "released", released_at: now.toISOString(), attempts, last_error: null })
    .eq("id", row.id);
  // Twilio released it; a retry of an already released SID is a 404, which counts as success.
  if (error) reportError(new Error(`record release: ${error.message}`), { route: ROUTE, extra: { releaseId: row.id } });
  const { error: eventErr } = await sb
    .from("events")
    .insert({ kind: "voice.number_released", merchant: null, payload: { release_id: row.id, sid: row.twilio_sid } });
  if (eventErr) reportError(new Error(`voice.number_released event: ${eventErr.message}`), { route: ROUTE });
  return "released";
}

/**
 * Account deletion: hand the merchant's number to the queue BEFORE any data is erased, and try
 * to release it right away. 409 while a purchase is in flight (it would finish after the rows
 * are gone). A Twilio failure does not block the deletion: the queue keeps retrying.
 */
export async function releaseVoiceNumberForErasure(
  sb: SupabaseClient,
  merchantId: string,
  deps: NumberReleaseDeps = DEFAULT_RELEASE_DEPS
): Promise<{ queued: boolean; released: boolean }> {
  const { data, error } = await sb
    .from("voice_configs")
    .select("phone_number, twilio_incoming_sid, provisioning_started_at")
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw new Error(`voice config lookup failed: ${error.message}`);
  const row = data as { phone_number: string | null; twilio_incoming_sid: string | null; provisioning_started_at: string | null } | null;
  if (!row || (!row.twilio_incoming_sid && !row.phone_number && !row.provisioning_started_at)) {
    return { queued: false, released: false };
  }

  const result = await queueVoiceNumberRelease(sb, merchantId, "account_deleted");
  if (result.outcome === "in_progress") {
    throw new HttpError(
      409,
      "A phone number is being bought for this store right now. Try deleting the account again in a few minutes.",
      "voice_provisioning_in_progress"
    );
  }
  if (result.outcome !== "queued") return { queued: false, released: false };
  const outcome = await attemptVoiceNumberRelease(sb, { id: result.release_id, twilio_sid: result.twilio_sid, attempts: 0 }, deps);
  return { queued: true, released: outcome === "released" };
}

export type DrainReport = { released: number; failed: number };

/** Retry due releases (employees-tick cron). */
export async function drainVoiceNumberReleases(
  sb: SupabaseClient,
  deps: NumberReleaseDeps = DEFAULT_RELEASE_DEPS,
  limit = DRAIN_BATCH
): Promise<DrainReport> {
  const { data, error } = await sb
    .from("voice_number_releases")
    .select("id, twilio_sid, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", deps.now().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`voice number releases lookup failed: ${error.message}`);
  const report: DrainReport = { released: 0, failed: 0 };
  for (const row of (data ?? []) as ReleaseRow[]) {
    const outcome = await attemptVoiceNumberRelease(sb, row, deps);
    report[outcome === "released" ? "released" : "failed"] += 1;
  }
  return report;
}

type SweepMerchant = Pick<Merchant, "plan" | "subscription_status" | "uninstalled_at">;
type SweepRow = {
  merchant_id: string;
  entitlement_lost_at: string | null;
  /** many-to-one embed: an object (supabase-js types it as an array) */
  merchants: SweepMerchant | SweepMerchant[] | null;
};

export type SweepReport = { flagged: number; restored: number; queued: number; released: number; failed: number };

/**
 * Numbers whose merchant lost voice (plan / subscription) or uninstalled the Salla app: stamp
 * the moment entitlement was first seen missing, clear it when it comes back, and release the
 * number once either condition has lasted RELEASE_GRACE_DAYS.
 */
export async function sweepLapsedVoiceNumbers(
  sb: SupabaseClient,
  deps: NumberReleaseDeps = DEFAULT_RELEASE_DEPS
): Promise<SweepReport> {
  const now = deps.now();
  const { data, error } = await sb
    .from("voice_configs")
    .select("merchant_id, entitlement_lost_at, merchants(plan, subscription_status, uninstalled_at)")
    .not("phone_number", "is", null)
    .limit(SWEEP_BATCH);
  if (error) throw new Error(`voice numbers sweep lookup failed: ${error.message}`);

  const report: SweepReport = { flagged: 0, restored: 0, queued: 0, released: 0, failed: 0 };
  for (const row of (data ?? []) as unknown as SweepRow[]) {
    const merchant = Array.isArray(row.merchants) ? (row.merchants[0] ?? null) : row.merchants;
    if (!merchant) continue;
    const entitled = merchantCanUseFeature(merchant, "voice");

    if (entitled && row.entitlement_lost_at) {
      const { error: e } = await sb.from("voice_configs").update({ entitlement_lost_at: null }).eq("merchant_id", row.merchant_id);
      if (e) reportError(new Error(`clear entitlement_lost_at: ${e.message}`), { route: ROUTE, merchantId: row.merchant_id });
      else report.restored += 1;
    } else if (!entitled && !row.entitlement_lost_at) {
      const { error: e } = await sb
        .from("voice_configs")
        .update({ entitlement_lost_at: now.toISOString() })
        .eq("merchant_id", row.merchant_id)
        .is("entitlement_lost_at", null);
      if (e) reportError(new Error(`stamp entitlement_lost_at: ${e.message}`), { route: ROUTE, merchantId: row.merchant_id });
      else report.flagged += 1;
    }

    const lostAt = !entitled && row.entitlement_lost_at ? Date.parse(row.entitlement_lost_at) : NaN;
    const uninstalledAt = merchant.uninstalled_at ? Date.parse(merchant.uninstalled_at) : NaN;
    const reason: Exclude<ReleaseReason, "account_deleted" | "unrecorded_purchase"> | null =
      Number.isFinite(lostAt) && now.getTime() - lostAt >= RELEASE_GRACE_DAYS * DAY_MS
        ? "plan_lapsed"
        : Number.isFinite(uninstalledAt) && now.getTime() - uninstalledAt >= RELEASE_GRACE_DAYS * DAY_MS
          ? "store_uninstalled"
          : null;
    if (!reason) continue;

    try {
      const result = await queueVoiceNumberRelease(sb, row.merchant_id, reason);
      if (result.outcome !== "queued") continue;
      report.queued += 1;
      const outcome = await attemptVoiceNumberRelease(sb, { id: result.release_id, twilio_sid: result.twilio_sid, attempts: 0 }, deps);
      report[outcome === "released" ? "released" : "failed"] += 1;
    } catch (err) {
      reportError(err, { route: ROUTE, merchantId: row.merchant_id, extra: { reason } });
      report.failed += 1;
    }
  }
  return report;
}
