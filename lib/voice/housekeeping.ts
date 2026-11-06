/**
 * Voice maintenance, run by the employees-tick cron (every 5 minutes, CRON_SECRET):
 *   1. retention (SW-45): voice.* events and the call log older than 30 days
 *      (prune_voice_records, 20261106006000_voice_agent.sql);
 *   2. lapsed numbers (SW-22): plan / subscription lost or Salla uninstalled for the grace
 *      period → number released;
 *   3. the release queue (SW-22): due retries of numbers Twilio has not released yet.
 * Never throws: each step reports its own failure and the others still run.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/error-reporter";
import {
  DEFAULT_RELEASE_DEPS,
  drainVoiceNumberReleases,
  sweepLapsedVoiceNumbers,
  type DrainReport,
  type NumberReleaseDeps,
  type SweepReport
} from "@/lib/voice/number-release";

export const VOICE_RETENTION_DAYS = 30;
const ROUTE = "cron/employees-tick";

export type VoiceHousekeepingReport = {
  pruned: { events: number; calls: number; releases: number } | null;
  lapsed: SweepReport | null;
  releases: DrainReport | null;
  errors: number;
};

export async function runVoiceHousekeeping(
  sb: SupabaseClient,
  deps: NumberReleaseDeps = DEFAULT_RELEASE_DEPS
): Promise<VoiceHousekeepingReport> {
  const report: VoiceHousekeepingReport = { pruned: null, lapsed: null, releases: null, errors: 0 };

  try {
    const { data, error } = await sb.rpc("prune_voice_records", { p_older_than_days: VOICE_RETENTION_DAYS });
    if (error) throw new Error(`prune_voice_records: ${error.message}`);
    const counts = (data ?? {}) as Partial<Record<"events" | "calls" | "releases", number>>;
    report.pruned = { events: counts.events ?? 0, calls: counts.calls ?? 0, releases: counts.releases ?? 0 };
  } catch (err) {
    report.errors += 1;
    reportError(err, { route: ROUTE, extra: { step: "voice retention" } });
  }

  try {
    report.lapsed = await sweepLapsedVoiceNumbers(sb, deps);
  } catch (err) {
    report.errors += 1;
    reportError(err, { route: ROUTE, extra: { step: "voice lapsed numbers" } });
  }

  try {
    report.releases = await drainVoiceNumberReleases(sb, deps);
  } catch (err) {
    report.errors += 1;
    reportError(err, { route: ROUTE, extra: { step: "voice number releases" } });
  }

  return report;
}
