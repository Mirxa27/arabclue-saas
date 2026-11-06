/**
 * Plan generation for POST /api/social/plan (SW-31, SW-32, SW-46, SW-12).
 *
 *  - The request's postsPerWeek and horizon decide the post count; a count one plan cannot hold
 *    is a 400 before any LLM spend.
 *  - Platforms are the merchant's connected, publishable channels (never a fixed default).
 *  - LLM-chosen times are validated strictly: ISO with offset, inside
 *    [now + review lead time, now + horizon]; anything else is dropped and reported.
 *  - Fan-out is bounded: at most PLAN_LIMITS.maxCopyCalls copywriter calls, PLAN_LIMITS.llmConcurrency
 *    at once, and no new call after PLAN_LIMITS.maxLlmFailures failures.
 *  - Media comes from the merchant's own catalog only; an Instagram post without a catalog image
 *    loses Instagram (or is dropped) at planning time instead of failing at the cron.
 *  - X captions over 280 weighted characters are rewritten once, then shortened on token
 *    boundaries — so what the merchant reviews is what X accepts.
 *
 * The output is inserted as drafts: nothing publishes before the merchant approves it.
 */
import { z } from "zod";
import { truncateForX, xWeightedLength, X_MAX_WEIGHTED_LENGTH } from "@/lib/x/text";
import { PLANNER_MAX_POSTS, copywriter, planner, visualist } from "./agent";
import { mediaForProducts } from "./media";
import { runBounded } from "./pool";
import {
  PUBLISHABLE_PLATFORMS,
  SOCIAL_PLATFORMS,
  type BrandVoice,
  type Copy,
  type PlannedPost,
  type PostMedia,
  type Product,
  type PublishablePlatform,
  type VisualBrief
} from "./types";

export const PLAN_LIMITS = {
  minHorizonDays: 7,
  maxHorizonDays: 60,
  maxPostsPerPlan: PLANNER_MAX_POSTS,
  /** Total copywriter calls per plan (posts × platforms), before X rewrites. */
  maxCopyCalls: 60,
  llmConcurrency: 4,
  maxLlmFailures: 3,
  /** Generated posts are never scheduled sooner than this after generation. */
  reviewLeadMs: 60 * 60_000,
  /** Per merchant, rolling 24 h. */
  dailyQuota: 5,
  /** A generation still "running" after this is considered dead (route maxDuration is 300 s). */
  staleRunSeconds: 600,
  /** One generation per merchant per window. */
  rateLimitWindowMs: 5 * 60_000
} as const;

const DAY_MS = 24 * 60 * 60_000;

export function plannedPostCount(horizonDays: number, postsPerWeek: number): number {
  return Math.max(1, Math.round((postsPerWeek * horizonDays) / 7));
}

export const PlanRequestSchema = z
  .object({
    horizonDays: z.number().int().min(PLAN_LIMITS.minHorizonDays).max(PLAN_LIMITS.maxHorizonDays).default(30),
    postsPerWeek: z.number().int().min(1).max(14).default(5),
    platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).max(6).optional(),
    /** Cancel the merchant's unapproved drafts from earlier plans and replace them. */
    replaceDrafts: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    const count = plannedPostCount(value.horizonDays, value.postsPerWeek);
    if (count > PLAN_LIMITS.maxPostsPerPlan) {
      ctx.addIssue({
        code: "custom",
        path: ["postsPerWeek"],
        message: `${value.postsPerWeek} posts a week for ${value.horizonDays} days is ${count} posts; one plan holds at most ${PLAN_LIMITS.maxPostsPerPlan}. Lower postsPerWeek or horizonDays.`
      });
    }
  });
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export type PlanDrops = {
  invalidTime: number;
  outsideWindow: number;
  noPlatform: number;
  noImage: number;
  overTarget: number;
  overBudget: number;
  generationFailed: number;
};

export type PlanStats = {
  requested: number;
  planned: number;
  kept: number;
  dropped: PlanDrops;
  /** Posts that kept their other platforms but lost Instagram for lack of a catalog image. */
  instagramRemoved: number;
  /** X captions shortened after the rewrite was still too long. */
  xShortened: number;
  llmCalls: number;
};

export type GeneratedPost = {
  post: PlannedPost;
  copies: Partial<Record<PublishablePlatform, Copy>>;
  visualBrief: VisualBrief | null;
  productIds: string[];
  media: PostMedia[];
};

export type PlanLlm = {
  planner: typeof planner;
  copywriter: typeof copywriter;
  visualist: typeof visualist;
};

const DEFAULT_LLM: PlanLlm = { planner, copywriter, visualist };

const IsoWithOffset = z.iso.datetime({ offset: true });

export type PlanWindow = { start: Date; end: Date };

export function planWindow(now: Date, horizonDays: number): PlanWindow {
  return { start: new Date(now.getTime() + PLAN_LIMITS.reviewLeadMs), end: new Date(now.getTime() + horizonDays * DAY_MS) };
}

type Validated = { post: PlannedPost; productIds: string[]; media: PostMedia[]; instagramRemoved: boolean };

/** Strictly validate one LLM-planned post against the window, the platforms and the catalog. */
export function validatePlannedPost(
  post: PlannedPost,
  ctx: { window: PlanWindow; platforms: readonly PublishablePlatform[]; catalog: ReadonlyMap<string, Product> }
): { ok: true; value: Validated } | { ok: false; reason: keyof PlanDrops } {
  if (!IsoWithOffset.safeParse(post.scheduledFor).success) return { ok: false, reason: "invalidTime" };
  const at = Date.parse(post.scheduledFor);
  if (!Number.isFinite(at)) return { ok: false, reason: "invalidTime" };
  if (at < ctx.window.start.getTime() || at > ctx.window.end.getTime()) return { ok: false, reason: "outsideWindow" };

  let platforms = [...new Set(post.platforms)].filter((p): p is PublishablePlatform =>
    (ctx.platforms as readonly string[]).includes(p)
  );
  if (platforms.length === 0) return { ok: false, reason: "noPlatform" };

  const productIds = [...new Set(post.productIds)].filter((id) => ctx.catalog.has(id)).slice(0, 10);
  const media = mediaForProducts(productIds, ctx.catalog);
  let instagramRemoved = false;
  if (platforms.includes("instagram") && media.length === 0) {
    platforms = platforms.filter((p) => p !== "instagram");
    instagramRemoved = true;
    if (platforms.length === 0) return { ok: false, reason: "noImage" };
  }

  return {
    ok: true,
    value: {
      post: { ...post, scheduledFor: new Date(at).toISOString(), platforms, productIds },
      productIds,
      media,
      instagramRemoved
    }
  };
}

export async function generateSocialPlan(input: {
  brand: BrandVoice;
  products: Product[];
  platforms: PublishablePlatform[];
  horizonDays: number;
  postsPerWeek: number;
  now?: Date;
  llm?: PlanLlm;
  limits?: Partial<{ maxCopyCalls: number; llmConcurrency: number; maxLlmFailures: number }>;
}): Promise<{ posts: GeneratedPost[]; stats: PlanStats; window: PlanWindow }> {
  const llm = input.llm ?? DEFAULT_LLM;
  const limits = {
    maxCopyCalls: input.limits?.maxCopyCalls ?? PLAN_LIMITS.maxCopyCalls,
    llmConcurrency: input.limits?.llmConcurrency ?? PLAN_LIMITS.llmConcurrency,
    maxLlmFailures: input.limits?.maxLlmFailures ?? PLAN_LIMITS.maxLlmFailures
  };
  const now = input.now ?? new Date();
  const window = planWindow(now, input.horizonDays);
  const target = Math.min(plannedPostCount(input.horizonDays, input.postsPerWeek), PLAN_LIMITS.maxPostsPerPlan);
  const platforms = [...new Set(input.platforms)].filter((p) => (PUBLISHABLE_PLATFORMS as readonly string[]).includes(p));
  const catalog = new Map(input.products.map((p) => [p.id, p]));

  const stats: PlanStats = {
    requested: target,
    planned: 0,
    kept: 0,
    dropped: { invalidTime: 0, outsideWindow: 0, noPlatform: 0, noImage: 0, overTarget: 0, overBudget: 0, generationFailed: 0 },
    instagramRemoved: 0,
    xShortened: 0,
    llmCalls: 0
  };

  stats.llmCalls += 1;
  const planned = await llm.planner({
    brand: input.brand,
    products: input.products,
    window: { startISO: window.start.toISOString(), endISO: window.end.toISOString(), days: input.horizonDays },
    platforms,
    postsPerWeek: input.postsPerWeek,
    target
  });
  stats.planned = planned.length;

  // ── validate, order, cap to the requested count and the copy budget ───────
  const valid: Validated[] = [];
  for (const post of planned) {
    const checked = validatePlannedPost(post, { window, platforms, catalog });
    if (!checked.ok) {
      stats.dropped[checked.reason] += 1;
      continue;
    }
    if (checked.value.instagramRemoved) stats.instagramRemoved += 1;
    valid.push(checked.value);
  }
  valid.sort((a, b) => Date.parse(a.post.scheduledFor) - Date.parse(b.post.scheduledFor));
  if (valid.length > target) {
    stats.dropped.overTarget += valid.length - target;
    valid.length = target;
  }
  const budgeted: Validated[] = [];
  let copyCalls = 0;
  for (const v of valid) {
    if (copyCalls + v.post.platforms.length > limits.maxCopyCalls) {
      stats.dropped.overBudget += 1;
      continue;
    }
    copyCalls += v.post.platforms.length;
    budgeted.push(v);
  }

  // ── copy + visual brief per post, bounded ─────────────────────────────────
  const writeCopy = async (v: Validated, platform: PublishablePlatform, product?: Product): Promise<Copy> => {
    stats.llmCalls += 1;
    let copy = await llm.copywriter({ post: v.post, brand: input.brand, product, platform });
    if (platform === "x" && xWeightedLength(copy.caption) > X_MAX_WEIGHTED_LENGTH) {
      stats.llmCalls += 1;
      copy = await llm.copywriter({
        post: v.post,
        brand: input.brand,
        product,
        platform,
        feedback: `The previous X caption was ${xWeightedLength(copy.caption)} weighted characters; X allows ${X_MAX_WEIGHTED_LENGTH} (emoji count 2, links 23). Rewrite it under 240.`
      });
      if (xWeightedLength(copy.caption) > X_MAX_WEIGHTED_LENGTH) {
        copy = { ...copy, caption: truncateForX(copy.caption) };
        stats.xShortened += 1;
      }
    }
    return copy;
  };

  const { results } = await runBounded(
    budgeted,
    async (v): Promise<GeneratedPost> => {
      const product = v.productIds[0] ? catalog.get(v.productIds[0]) : undefined;
      const copies: Partial<Record<PublishablePlatform, Copy>> = {};
      for (const platform of v.post.platforms as PublishablePlatform[]) {
        copies[platform] = await writeCopy(v, platform, product);
      }
      stats.llmCalls += 1;
      const visualBrief = await llm.visualist({ post: v.post, brand: input.brand, product, platform: v.post.platforms[0] });
      return { post: v.post, copies, visualBrief, productIds: v.productIds, media: v.media };
    },
    { concurrency: limits.llmConcurrency, maxFailures: limits.maxLlmFailures }
  );

  const posts: GeneratedPost[] = [];
  for (const r of results) {
    if (r.ok) posts.push(r.value);
    else stats.dropped.generationFailed += 1;
  }
  stats.kept = posts.length;
  return { posts, stats, window };
}
