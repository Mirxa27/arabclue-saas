/**
 * The social publishing run (GET /api/cron/social-scheduler) — idempotent by construction.
 *
 *   1. Recover stale claims (a run that died): platforms left at 'sending' become 'unknown' and
 *      the post is closed for the merchant to check; a post with nothing in flight goes back to
 *      the queue (its published platforms stay recorded and are skipped next time).
 *   2. Hold due posts that must not publish (plan_required / missed_window).
 *   3. Claim small batches (FOR UPDATE SKIP LOCKED) and publish each claimed post platform by
 *      platform: 'sending' is stored before the provider call and the outcome right after it,
 *      so a crash can never turn into a silent re-post. Platforms already published (or
 *      unknown) are never sent again. One platform's failure never stops the others.
 *   4. Stop claiming before the function's time limit; unfinished posts are released.
 *
 * Overlapping runs (Vercel duplicate delivery, a manual trigger) claim disjoint posts.
 */
import { redactSensitive, reportError } from "@/lib/observability/error-reporter";
import { classifyProviderError, PublishError } from "./publish-error";
import { summarizeOutcome, type PlatformResult, type PostOutcome } from "./outcomes";
import type { ClaimedPost, SocialPublishStore } from "./publish-store";
import type { MerchantPublishers } from "./publishers";
import { IMAGE_REQUIRED_PLATFORMS, type Platform } from "./types";

export const SCHEDULER_LIMITS = {
  /** Posts claimed per round trip (small, so a slow run holds few claims). */
  batchSize: 5,
  maxPostsPerRun: 50,
  /** Stop starting new work after this long (route maxDuration is 300 s). */
  runBudgetMs: 240_000,
  /** A claim older than this belongs to a run that died (maxDuration + margin). */
  staleClaimMs: 7 * 60_000,
  /** Claims a post may go through before a crash loop is closed as failed. */
  maxAttempts: 3,
  /** Later than this and a due post is not published at all (missed_window). */
  maxLatenessSeconds: 6 * 3600,
  saveRetries: 3
} as const;

export type SchedulerLimits = { -readonly [K in keyof typeof SCHEDULER_LIMITS]: number };

export type SchedulerDeps = {
  store: SocialPublishStore;
  publishersFor: (merchantId: string) => Promise<MerchantPublishers>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limits?: Partial<SchedulerLimits>;
};

export type PostRunStatus = "published" | "failed" | "released" | "abandoned";

export type SchedulerSummary = {
  recovered: number;
  held: number;
  claimed: number;
  published: number;
  partial: number;
  failed: number;
  released: number;
  abandoned: number;
  stoppedEarly: boolean;
  posts: Array<{ id: string; status: PostRunStatus; errorCode?: string | null }>;
};

const MESSAGE_MAX = 300;
const trimMessage = (message: string) => redactSensitive(message).slice(0, MESSAGE_MAX);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const UNKNOWN_AFTER_CRASH =
  "The publishing run stopped right after sending this, so it may or may not be live. Check the account before re-queueing.";

/** Leftover 'sending' (a run died after the provider call) → 'unknown'. Returns whether any changed. */
function settleInFlight(post: ClaimedPost, at: string): boolean {
  let changed = false;
  for (const [platform, result] of Object.entries(post.results) as Array<[Platform, PlatformResult]>) {
    if (result.status === "sending") {
      post.results[platform] = { status: "unknown", code: "outcome_unknown", message: UNKNOWN_AFTER_CRASH, at: result.at || at };
      changed = true;
    }
  }
  return changed;
}

export async function runSocialScheduler(deps: SchedulerDeps): Promise<SchedulerSummary> {
  const limits: SchedulerLimits = { ...SCHEDULER_LIMITS, ...(deps.limits ?? {}) };
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const iso = () => new Date(now()).toISOString();
  const deadline = now() + limits.runBudgetMs;
  const { store } = deps;

  const summary: SchedulerSummary = {
    recovered: 0,
    held: 0,
    claimed: 0,
    published: 0,
    partial: 0,
    failed: 0,
    released: 0,
    abandoned: 0,
    stoppedEarly: false,
    posts: []
  };
  const record = (id: string, status: PostRunStatus, errorCode?: string | null) => {
    summary.posts.push({ id, status, ...(errorCode !== undefined ? { errorCode } : {}) });
    if (status === "released") summary.released += 1;
    if (status === "abandoned") summary.abandoned += 1;
  };

  async function save(post: ClaimedPost): Promise<boolean> {
    for (let attempt = 0; attempt < limits.saveRetries; attempt++) {
      try {
        return await store.saveProgress(post);
      } catch (err) {
        if (attempt === limits.saveRetries - 1) {
          reportError(err, { merchantId: post.merchantId, extra: { step: "social progress write", postId: post.id } });
          return false;
        }
        await sleep(200 * 2 ** attempt);
      }
    }
    return false;
  }

  async function finish(post: ClaimedPost, outcome: PostOutcome): Promise<void> {
    let ok = false;
    for (let attempt = 0; attempt < limits.saveRetries && !ok; attempt++) {
      try {
        ok = await store.finalize(post, outcome);
        if (!ok) break; // claim gone — nothing to retry
      } catch (err) {
        if (attempt === limits.saveRetries - 1) {
          reportError(err, { merchantId: post.merchantId, extra: { step: "social finalize", postId: post.id } });
        } else {
          await sleep(200 * 2 ** attempt);
        }
      }
    }
    if (!ok) {
      // The stale-claim recovery will close it from what is stored.
      record(post.id, "abandoned");
      return;
    }
    record(post.id, outcome.status, outcome.errorCode);
    if (outcome.status === "published") {
      summary.published += 1;
      if (outcome.errorCode === "partial") summary.partial += 1;
    } else {
      summary.failed += 1;
    }
  }

  async function release(post: ClaimedPost, countAttempt: boolean): Promise<void> {
    settleInFlight(post, iso());
    try {
      const ok = await store.release(post, { countAttempt });
      record(post.id, ok ? "released" : "abandoned");
    } catch (err) {
      reportError(err, { merchantId: post.merchantId, extra: { step: "social release", postId: post.id } });
      record(post.id, "abandoned");
    }
  }

  // ── 1. stale claims ────────────────────────────────────────────────────────
  const stale = await store.listStale(new Date(now() - limits.staleClaimMs).toISOString(), 50);
  for (const post of stale) {
    settleInFlight(post, iso());
    const outcome = summarizeOutcome(post.platforms, post.results);
    const anyUnknown = Object.values(post.results).some((r) => r?.status === "unknown");
    if (anyUnknown) {
      await finish(post, outcome);
    } else if (post.attempts >= limits.maxAttempts) {
      await finish(
        post,
        outcome.status === "published"
          ? outcome
          : {
              ...outcome,
              errorCode: "too_many_attempts",
              error: `Not published — stopped after ${post.attempts} incomplete attempts`
            }
      );
    } else {
      await release(post, true);
    }
    summary.recovered += 1;
  }

  // ── 2. posts that must not publish ─────────────────────────────────────────
  summary.held = (await store.holdUnpublishable()).length;

  // ── 3. claim + publish ─────────────────────────────────────────────────────
  const publisherCache = new Map<string, Promise<MerchantPublishers>>();
  const publishersFor = (merchantId: string) => {
    let cached = publisherCache.get(merchantId);
    if (!cached) {
      cached = deps.publishersFor(merchantId);
      // A failed lookup is not cached: the next post of this merchant tries again.
      cached.catch(() => publisherCache.delete(merchantId));
      publisherCache.set(merchantId, cached);
    }
    return cached;
  };

  async function processPost(post: ClaimedPost): Promise<void> {
    // A leftover 'sending' from a dead run must never be re-sent.
    if (settleInFlight(post, iso()) && !(await save(post))) {
      record(post.id, "abandoned");
      return;
    }

    let publishers: MerchantPublishers;
    try {
      publishers = await publishersFor(post.merchantId);
    } catch (err) {
      reportError(err, { merchantId: post.merchantId, extra: { step: "social channels", postId: post.id } });
      await release(post, false);
      return;
    }

    for (const platform of post.platforms) {
      const existing = post.results[platform];
      if (existing?.status === "published" || existing?.status === "unknown") continue;
      if (now() >= deadline) {
        summary.stoppedEarly = true;
        await release(post, false);
        return;
      }

      const publisher = publishers.get(platform);
      const copy = post.copies[platform];
      let precheck: PlatformResult | null = null;
      if (!publisher || !publisher.available) {
        precheck = {
          status: "skipped",
          code: publisher && !publisher.available ? publisher.code : "not_connected",
          message: trimMessage(publisher && !publisher.available ? publisher.message : `${platform}: account not connected`),
          at: iso()
        };
      } else if (!copy?.caption.trim()) {
        precheck = { status: "skipped", code: "no_copy", message: `${platform}: no caption for this platform`, at: iso() };
      } else if (IMAGE_REQUIRED_PLATFORMS.includes(platform) && post.media.length === 0) {
        precheck = {
          status: "skipped",
          code: "no_image",
          message: `${platform}: this post has no image from your catalog`,
          at: iso()
        };
      }
      if (precheck || !publisher?.available || !copy) {
        // Nothing is sent; stored with the next write.
        if (precheck) post.results[platform] = precheck;
        continue;
      }

      // Marker first: if this run dies between the provider call and the next write, the
      // platform reads 'sending' → 'unknown', never "not attempted" → re-posted.
      post.results[platform] = { status: "sending", at: iso() };
      if (!(await save(post))) {
        record(post.id, "abandoned");
        return;
      }

      let result: PlatformResult;
      try {
        const receipt = await publisher.publish({ copy, visualBrief: post.visualBrief, images: post.media });
        result = { status: "published", remoteId: receipt.remoteId, at: iso() };
        post.remoteIds[platform] = receipt.remoteId;
      } catch (err) {
        const failure = err instanceof PublishError ? err : classifyProviderError(err, { final: true });
        result = { status: failure.outcome, code: failure.code, message: trimMessage(failure.message), at: iso() };
      }
      post.results[platform] = result;
      if (!(await save(post))) {
        // Stored state still says 'sending' → recovered as 'unknown'. Honest, never a re-post.
        record(post.id, "abandoned");
        return;
      }
    }

    await finish(post, summarizeOutcome(post.platforms, post.results));
  }

  outer: while (summary.claimed < limits.maxPostsPerRun) {
    if (now() >= deadline) {
      summary.stoppedEarly = true;
      break;
    }
    const batch = await store.claimDue(Math.min(limits.batchSize, limits.maxPostsPerRun - summary.claimed));
    if (batch.length === 0) break;
    summary.claimed += batch.length;
    for (let i = 0; i < batch.length; i++) {
      if (now() >= deadline) {
        summary.stoppedEarly = true;
        for (const rest of batch.slice(i)) await release(rest, false);
        break outer;
      }
      try {
        await processPost(batch[i]);
      } catch (err) {
        // A bug must not take the rest of the batch down; the claim is recovered later.
        reportError(err, { merchantId: batch[i].merchantId, extra: { step: "social publish", postId: batch[i].id } });
        record(batch[i].id, "abandoned");
      }
    }
  }

  return summary;
}
