/**
 * Wiring for the social cron on the service role: the claim-based store, per-merchant
 * publishers from the merchant's own channels, and the entitlement lists for the claim SQL.
 * Route: app/api/cron/social-scheduler/route.ts (probe: …/probe/route.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/db/supabase";
import { socialEntitledPlans, socialEntitledStatuses } from "./gates";
import { createSupabasePublishStore } from "./publish-store";
import { buildMerchantPublishers } from "./publishers";
import { SCHEDULER_LIMITS, runSocialScheduler, type SchedulerSummary } from "./scheduler";

export async function runSocialPublishing(
  opts: { maxPostsPerRun?: number; client?: SupabaseClient } = {}
): Promise<SchedulerSummary> {
  const sb = opts.client ?? getServiceSupabase();
  const store = createSupabasePublishStore(sb, {
    plans: socialEntitledPlans(),
    subscriptionStatuses: socialEntitledStatuses(),
    maxLatenessSeconds: SCHEDULER_LIMITS.maxLatenessSeconds
  });
  const maxPosts = Math.min(Math.max(Math.floor(opts.maxPostsPerRun ?? SCHEDULER_LIMITS.maxPostsPerRun), 1), 200);
  return runSocialScheduler({
    store,
    publishersFor: async (merchantId) => buildMerchantPublishers(sb, await store.loadChannels(merchantId)),
    limits: { maxPostsPerRun: maxPosts }
  });
}

export type SocialCronProbe = {
  ok: boolean;
  probe: true;
  socialAgentEnabled: boolean;
  /** Scheduled posts whose time has come (what the next run would look at). */
  due: number | null;
  error?: string;
};

/**
 * Side-effect-free health check for the admin "Social cron" test (SW-14): proves the cron secret
 * is accepted and the database (with this migration) is reachable. Claims and publishes nothing.
 */
export async function probeSocialCron(socialAgentEnabled: boolean, client?: SupabaseClient): Promise<SocialCronProbe> {
  const sb = client ?? getServiceSupabase();
  const { count, error } = await sb
    .from("social_posts")
    .select("id, claim_id", { count: "exact", head: true })
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString());
  if (error) {
    const missingMigration = error.code === "42703" || error.code === "PGRST204";
    return {
      ok: false,
      probe: true,
      socialAgentEnabled,
      due: null,
      error: missingMigration ? "social publishing migration (20261106005500) not applied" : "database query failed"
    };
  }
  return { ok: true, probe: true, socialAgentEnabled, due: count ?? 0 };
}
