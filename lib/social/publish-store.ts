/**
 * The scheduler's view of social_posts on the service role: claim through the database
 * (claim_due_social_posts), then every write conditional on the claim —
 * `where id = $1 and claim_id = $2 and status = 'publishing'` — with `{ error }` checked and the
 * affected row count read. A write that matches nothing means the claim is gone (another run
 * recovered it, or the owner changed the row) and the post is abandoned, never published.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePostMedia } from "./media";
import { parsePublishResults, parseRemoteIds, type PostOutcome, type PublishResults } from "./outcomes";
import { CHANNEL_COLUMNS, type ChannelRow } from "./token-refresh";
import { VisualBriefSchema, isPlatform, type Copy, type Platform, type PostMedia, type VisualBrief } from "./types";

export type ClaimedPost = {
  id: string;
  merchantId: string;
  claimId: string;
  attempts: number;
  scheduledFor: string;
  platforms: Platform[];
  copies: Partial<Record<Platform, Copy>>;
  visualBrief?: VisualBrief;
  media: PostMedia[];
  results: PublishResults;
  remoteIds: Record<string, string>;
};

export type HeldPost = { postId: string; merchantId: string; reason: string };

export interface SocialPublishStore {
  /** Fail due posts that must not publish (plan_required / missed_window). */
  holdUnpublishable(): Promise<HeldPost[]>;
  claimDue(limit: number): Promise<ClaimedPost[]>;
  /** Persist results + remote ids while holding the claim. false = the claim is gone. Throws on DB errors. */
  saveProgress(post: ClaimedPost): Promise<boolean>;
  finalize(post: ClaimedPost, outcome: PostOutcome): Promise<boolean>;
  /** Hand the post back to the queue (status 'scheduled'), keeping per-platform results. */
  release(post: ClaimedPost, opts: { countAttempt: boolean }): Promise<boolean>;
  listStale(claimedBeforeISO: string, limit: number): Promise<ClaimedPost[]>;
  loadChannels(merchantId: string): Promise<ChannelRow[]>;
}

export type EntitlementFilter = {
  plans: readonly string[];
  subscriptionStatuses: readonly string[];
  maxLatenessSeconds: number;
};

function parseCopies(value: unknown, platforms: readonly Platform[]): Partial<Record<Platform, Copy>> {
  const out: Partial<Record<Platform, Copy>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const platform of platforms) {
    const raw = (value as Record<string, unknown>)[platform];
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const caption = typeof c.caption === "string" ? c.caption : typeof c.body === "string" ? c.body : "";
    out[platform] = {
      caption,
      altText: typeof c.altText === "string" ? c.altText : "",
      cta: typeof c.cta === "string" ? c.cta : "",
      hashtags: Array.isArray(c.hashtags) ? c.hashtags.filter((h): h is string => typeof h === "string") : []
    };
  }
  return out;
}

/** A claimed social_posts row → ClaimedPost. Rows are owner-writable, so everything is checked. */
export function rowToClaimedPost(row: Record<string, unknown>): ClaimedPost | null {
  const id = typeof row.id === "string" ? row.id : null;
  const merchantId = typeof row.merchant_id === "string" ? row.merchant_id : null;
  const claimId = typeof row.claim_id === "string" ? row.claim_id : null;
  if (!id || !merchantId || !claimId) return null;
  const platforms = [...new Set((Array.isArray(row.platforms) ? row.platforms : []).filter(isPlatform))];
  const brief = VisualBriefSchema.safeParse(row.visual_brief);
  return {
    id,
    merchantId,
    claimId,
    attempts: typeof row.attempts === "number" ? row.attempts : 1,
    scheduledFor: typeof row.scheduled_for === "string" ? row.scheduled_for : "",
    platforms,
    copies: parseCopies(row.copies, platforms),
    visualBrief: brief.success ? brief.data : undefined,
    media: parsePostMedia(row.media),
    results: parsePublishResults(row.publish_results),
    remoteIds: parseRemoteIds(row.remote_ids)
  };
}

const POST_COLUMNS =
  "id, merchant_id, claim_id, claimed_at, attempts, scheduled_for, platforms, copies, visual_brief, media, publish_results, remote_ids, status";

export function createSupabasePublishStore(sb: SupabaseClient, filter: EntitlementFilter): SocialPublishStore {
  async function conditionalUpdate(post: ClaimedPost, values: Record<string, unknown>, action: string): Promise<boolean> {
    const { data, error } = await sb
      .from("social_posts")
      .update(values)
      .eq("id", post.id)
      .eq("claim_id", post.claimId)
      .eq("status", "publishing")
      .select("id");
    if (error) throw new Error(`social_posts ${action} failed: ${error.message}`);
    return Array.isArray(data) && data.length === 1;
  }

  return {
    async holdUnpublishable() {
      const { data, error } = await sb.rpc("social_hold_unpublishable_posts", {
        p_plans: [...filter.plans],
        p_subscription_statuses: [...filter.subscriptionStatuses],
        p_max_lateness_seconds: filter.maxLatenessSeconds,
        p_limit: 500
      });
      if (error) throw new Error(`social_hold_unpublishable_posts failed: ${error.message}`);
      return ((data ?? []) as Array<{ held_post_id: string; held_merchant_id: string; held_reason: string }>).map((r) => ({
        postId: r.held_post_id,
        merchantId: r.held_merchant_id,
        reason: r.held_reason
      }));
    },

    async claimDue(limit) {
      const { data, error } = await sb.rpc("claim_due_social_posts", {
        p_limit: limit,
        p_plans: [...filter.plans],
        p_subscription_statuses: [...filter.subscriptionStatuses],
        p_max_lateness_seconds: filter.maxLatenessSeconds
      });
      if (error) throw new Error(`claim_due_social_posts failed: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>)
        .map(rowToClaimedPost)
        .filter((p): p is ClaimedPost => p !== null);
    },

    saveProgress(post) {
      return conditionalUpdate(post, { publish_results: post.results, remote_ids: post.remoteIds }, "progress write");
    },

    finalize(post, outcome) {
      return conditionalUpdate(
        post,
        {
          status: outcome.status,
          published_at: outcome.publishedAt,
          error: outcome.error,
          error_code: outcome.errorCode,
          publish_results: post.results,
          remote_ids: post.remoteIds,
          claim_id: null,
          claimed_at: null
        },
        "finalize"
      );
    },

    release(post, opts) {
      return conditionalUpdate(
        post,
        {
          status: "scheduled",
          claim_id: null,
          claimed_at: null,
          attempts: opts.countAttempt ? post.attempts : Math.max(0, post.attempts - 1),
          publish_results: post.results,
          remote_ids: post.remoteIds
        },
        "release"
      );
    },

    async listStale(claimedBeforeISO, limit) {
      const { data, error } = await sb
        .from("social_posts")
        .select(POST_COLUMNS)
        .eq("status", "publishing")
        .lt("claimed_at", claimedBeforeISO)
        .order("claimed_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`stale social_posts lookup failed: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>)
        .map(rowToClaimedPost)
        .filter((p): p is ClaimedPost => p !== null);
    },

    async loadChannels(merchantId) {
      const { data, error } = await sb.from("social_channels").select(CHANNEL_COLUMNS).eq("merchant_id", merchantId);
      if (error) throw new Error(`social_channels lookup failed: ${error.message}`);
      return (data ?? []) as ChannelRow[];
    }
  };
}
