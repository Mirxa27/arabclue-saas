/**
 * Plan generation (lib/social/plan.ts): request bounds, strict time window, platform/catalog
 * validation, bounded LLM fan-out and X caption limits (SW-12, SW-31, SW-32, SW-46).
 * The LLM agents are injected; everything else is real.
 */
import { describe, expect, it, vi } from "vitest";
import { generateSocialPlan, PlanRequestSchema, plannedPostCount, type PlanLlm } from "@/lib/social/plan";
import { plannerMaxTokens } from "@/lib/social/agent";
import { xWeightedLength } from "@/lib/x/text";
import type { BrandVoice, Copy, PlannedPost, Product, VisualBrief } from "@/lib/social/types";

const NOW = new Date("2026-11-06T12:00:00Z");
const HOUR = 3600_000;
const brand: BrandVoice = { name: "Oud House", essence: "premium oud", attributes: ["warm"], dialect: "khaliji" };
const products: Product[] = [
  { id: "p-img", name: "Oud", description: "", price: 100, currency: "SAR", category: "oud", imageUrl: "https://cdn.salla.sa/oud.jpg" },
  { id: "p-noimg", name: "Musk", description: "", price: 50, currency: "SAR", category: "musk" }
];
const brief: VisualBrief = { layout: "single", slides: [{ kind: "hero", headline: "h" }], paletteCue: "sand" };

function planned(i: number, overrides: Partial<PlannedPost> = {}): PlannedPost {
  return {
    scheduledFor: new Date(NOW.getTime() + (2 + i) * HOUR).toISOString().replace("Z", "+00:00"),
    platforms: ["x"],
    goal: "awareness",
    productIds: [],
    hook: `hook ${i}`,
    rationale: "r",
    ...overrides
  };
}

function fakeLlm(posts: PlannedPost[], copy?: (platform: string, feedback?: string) => Copy | Promise<Copy>) {
  return {
    planner: vi.fn<PlanLlm["planner"]>(async () => posts),
    copywriter: vi.fn<PlanLlm["copywriter"]>(async (input) =>
      copy ? copy(input.platform, input.feedback) : { caption: `${input.platform} caption`, altText: "", cta: "", hashtags: [] }
    ),
    visualist: vi.fn<PlanLlm["visualist"]>(async () => brief)
  };
}

const generate = (llm: PlanLlm, extra: Partial<Parameters<typeof generateSocialPlan>[0]> = {}) =>
  generateSocialPlan({ brand, products, platforms: ["x", "instagram", "linkedin"], horizonDays: 30, postsPerWeek: 5, now: NOW, llm, ...extra });

describe("PlanRequestSchema", () => {
  it("accepts every horizon in range whose post count one plan can hold", () => {
    expect(PlanRequestSchema.safeParse({ horizonDays: 7, postsPerWeek: 5 }).success).toBe(true); // 5 posts (the old schema needed ≥ 8)
    expect(PlanRequestSchema.safeParse({ horizonDays: 60, postsPerWeek: 4 }).success).toBe(true); // 34
    expect(PlanRequestSchema.safeParse({}).data).toMatchObject({ horizonDays: 30, postsPerWeek: 5 });
  });

  it("rejects counts over 40 before any LLM spend, and out-of-range values", () => {
    const tooMany = PlanRequestSchema.safeParse({ horizonDays: 60, postsPerWeek: 14 });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues[0].message).toMatch(/120 posts; one plan holds at most 40/);
    expect(PlanRequestSchema.safeParse({ horizonDays: 6 }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ horizonDays: 61 }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ postsPerWeek: 2.5 }).success).toBe(false);
    expect(PlanRequestSchema.safeParse({ platforms: [] }).success).toBe(false);
  });
});

describe("generateSocialPlan", () => {
  it("passes postsPerWeek, the exact window and the connected platforms to the planner", async () => {
    const llm = fakeLlm([planned(0)]);
    await generate(llm, { postsPerWeek: 14, platforms: ["x", "linkedin"] });
    const input = llm.planner.mock.calls[0][0];
    expect(input.postsPerWeek).toBe(14);
    expect(plannedPostCount(30, 14)).toBe(60); // the request schema rejects this; the generator caps anyway
    expect(input.target).toBe(40);
    expect(input.platforms).toEqual(["x", "linkedin"]);
    expect(input.window).toEqual({
      startISO: new Date(NOW.getTime() + HOUR).toISOString(),
      endISO: new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString(),
      days: 30
    });
    expect(plannerMaxTokens(40)).toBe(6000);
    expect(plannerMaxTokens(21)).toBe(3340);
  });

  it("drops LLM times that are malformed, in the past, inside the review lead time or past the horizon", async () => {
    const llm = fakeLlm([
      planned(0, { scheduledFor: "2025-01-01T09:00:00Z" }), // past
      planned(1, { scheduledFor: new Date(NOW.getTime() + 30 * 60_000).toISOString() }), // inside the 1 h lead
      planned(2, { scheduledFor: "2026-11-07 09:00" }), // not ISO with an offset
      planned(3, { scheduledFor: new Date(NOW.getTime() + 31 * 24 * HOUR).toISOString() }), // past the horizon
      planned(4, { scheduledFor: "2026-11-07T09:00:00+03:00" }) // valid, Riyadh offset
    ]);
    const { posts, stats } = await generate(llm);
    expect(stats.dropped).toMatchObject({ invalidTime: 1, outsideWindow: 3 });
    expect(posts.map((p) => p.post.scheduledFor)).toEqual(["2026-11-07T06:00:00.000Z"]);
  });

  it("keeps only connected publishable platforms and only the merchant's own catalog images", async () => {
    const llm = fakeLlm([
      planned(0, { platforms: ["x", "tiktok", "x", "whatsapp"] }),
      planned(1, { platforms: ["instagram", "x"], productIds: ["p-noimg"] }), // no image: loses Instagram
      planned(2, { platforms: ["instagram"], productIds: ["p-img", "someone-elses-product"] }),
      planned(3, { platforms: ["instagram"] }), // Instagram only, no image: dropped
      planned(4, { platforms: ["tiktok"] })
    ]);
    const { posts, stats } = await generate(llm);
    expect(posts.map((p) => p.post.platforms)).toEqual([["x"], ["x"], ["instagram"]]);
    expect(posts[2]).toMatchObject({ productIds: ["p-img"], media: [{ url: "https://cdn.salla.sa/oud.jpg", productId: "p-img" }] });
    expect(stats).toMatchObject({ instagramRemoved: 1, dropped: { noImage: 1, noPlatform: 1 } });
  });

  it("never asks for more posts than requested nor more copy than the budget", async () => {
    const many = Array.from({ length: 40 }, (_, i) => planned(i, { platforms: ["x", "linkedin", "instagram"], productIds: ["p-img"] }));
    const llm = fakeLlm(many);
    const { posts, stats } = await generate(llm, { horizonDays: 56, postsPerWeek: 5 }); // target 40
    expect(llm.copywriter).toHaveBeenCalledTimes(60); // 20 posts × 3 platforms, not 120
    expect(posts).toHaveLength(20);
    expect(stats.dropped.overBudget).toBe(20);

    const extra = fakeLlm(Array.from({ length: 30 }, (_, i) => planned(i)));
    const { posts: capped, stats: cappedStats } = await generate(extra); // target 21
    expect(capped).toHaveLength(21);
    expect(cappedStats.dropped.overTarget).toBe(9);
  });

  it("stops starting LLM calls after repeated failures instead of firing all of them", async () => {
    const llm = fakeLlm(Array.from({ length: 21 }, (_, i) => planned(i)), () => {
      throw new Error("429 rate limit");
    });
    const { posts, stats } = await generate(llm);
    expect(posts).toHaveLength(0);
    // at most maxLlmFailures + (concurrency − 1) calls in flight when the third failure lands
    expect(llm.copywriter.mock.calls.length).toBeLessThanOrEqual(3 + 4 - 1);
    expect(stats.dropped.generationFailed).toBe(21);
  });

  it("rewrites an X caption that is over 280 weighted characters, then shortens it on token boundaries", async () => {
    const long = `${"ع".repeat(270)}${"✨".repeat(10)}`; // 290 weighted
    const llm = fakeLlm([planned(0)], () => ({ caption: long, altText: "", cta: "", hashtags: [] }));
    const { posts, stats } = await generate(llm);
    expect(llm.copywriter).toHaveBeenCalledTimes(2);
    expect(llm.copywriter.mock.calls[1][0].feedback).toMatch(/290 weighted characters; X allows 280/);
    expect(xWeightedLength(posts[0].copies.x!.caption)).toBeLessThanOrEqual(280);
    expect(stats.xShortened).toBe(1);
    expect(stats.llmCalls).toBe(1 + 2 + 1); // planner + copy (rewrite) + visual brief
  });
});
