/**
 * The cron routes and the claim-conditional store (SW-9, SW-11, SW-13, SW-14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  socialEnabled: true
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.service.client }));
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({
    social: { enabled: h.socialEnabled, cronMinutes: 15, maxPostsPerRun: 50 },
    voice: { enabled: true, defaultDialect: "khaliji" },
    seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
  })),
  getFeatureSettings: vi.fn(async () => ({ billing: true, zatca: true, wathq: true, socialOAuth: true }))
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { GET as cronGET } from "@/app/api/cron/social-scheduler/route";
import { GET as probeGET } from "@/app/api/cron/social-scheduler/probe/route";
import { createSupabasePublishStore, type ClaimedPost } from "@/lib/social/publish-store";
import { socialEntitledPlans, socialEntitledStatuses } from "@/lib/social/gates";

const SECRET = "cron-secret-for-tests";
const req = (path: string, auth = true) =>
  new NextRequest(`http://localhost${path}`, { headers: auth ? { authorization: `Bearer ${SECRET}` } : {} });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  h.socialEnabled = true;
  h.service = createFakeSupabase("service", () => ({ data: [] }), () => ({ data: [] }));
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/social-scheduler", () => {
  it("requires the cron secret", async () => {
    expect((await cronGET(req("/api/cron/social-scheduler", false))).status).toBe(401);
    expect(h.service.rpcCalls).toHaveLength(0);
  });

  it("does nothing while the admin kill switch is off", async () => {
    h.socialEnabled = false;
    const res = await cronGET(req("/api/cron/social-scheduler"));
    expect(await res.json()).toMatchObject({ ran: 0, skipped: "social agent disabled platform-wide" });
    expect(h.service.rpcCalls).toHaveLength(0);
    expect(h.service.calls).toHaveLength(0);
  });

  it("recovers stale claims, holds unpublishable posts, then claims with the plan gate", async () => {
    const res = await cronGET(req("/api/cron/social-scheduler"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ran: 0, claimed: 0, held: 0 });
    expect(h.service.calls[0]).toMatchObject({ table: "social_posts", op: "select" });
    expect(h.service.calls[0].filters).toContainEqual(["eq", "status", "publishing"]);
    expect(h.service.rpcCalls.map((c) => c.fn)).toEqual(["social_hold_unpublishable_posts", "claim_due_social_posts"]);
    expect(h.service.rpcCalls[1].args).toEqual({
      p_limit: 5,
      p_plans: ["plus", "pro", "enterprise"],
      p_subscription_statuses: ["active", "past_due"],
      p_max_lateness_seconds: 21600
    });
  });
});

describe("GET /api/cron/social-scheduler/probe (admin connection test)", () => {
  it("checks auth and the database without claiming or publishing anything", async () => {
    h.service = createFakeSupabase("service", () => ({ count: 3 }));
    const res = await probeGET(req("/api/cron/social-scheduler/probe"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, probe: true, socialAgentEnabled: true, due: 3 });
    expect(h.service.rpcCalls).toHaveLength(0);
    expect(h.service.writes()).toHaveLength(0);
    expect((await probeGET(req("/api/cron/social-scheduler/probe", false))).status).toBe(401);
  });

  it("reports a missing migration instead of claiming success", async () => {
    h.service = createFakeSupabase("service", () => ({ error: { code: "42703", message: "column social_posts.claim_id does not exist" } }));
    const res = await probeGET(req("/api/cron/social-scheduler/probe"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("20261106005500") });
  });
});

describe("entitlement lists passed to the claim SQL", () => {
  it("are derived from lib/billing/entitlements.ts", () => {
    expect(socialEntitledPlans()).toEqual(["plus", "pro", "enterprise"]);
    expect(socialEntitledStatuses()).toEqual(["active", "past_due"]);
  });
});

describe("createSupabasePublishStore — claim-conditional writes", () => {
  const post: ClaimedPost = {
    id: "post-1",
    merchantId: "m1",
    claimId: "claim-1",
    attempts: 1,
    scheduledFor: "2026-11-06T12:00:00.000Z",
    platforms: ["x"],
    copies: { x: { caption: "hi", altText: "", cta: "", hashtags: [] } },
    media: [],
    results: { x: { status: "sending", at: "2026-11-06T12:00:01.000Z" } },
    remoteIds: {}
  };
  const filter = { plans: ["plus"], subscriptionStatuses: ["active"], maxLatenessSeconds: 21600 };

  it("writes only while holding the claim, and reports a lost claim", async () => {
    let affected: unknown[] = [{ id: "post-1" }];
    const sb = createFakeSupabase("service", () => ({ data: affected }));
    const store = createSupabasePublishStore(sb.client, filter);
    await expect(store.saveProgress(post)).resolves.toBe(true);
    const write = sb.writes()[0];
    expect(write).toMatchObject({ table: "social_posts", op: "update", payload: { publish_results: post.results, remote_ids: {} } });
    expect(write.filters).toEqual([
      ["eq", "id", "post-1"],
      ["eq", "claim_id", "claim-1"],
      ["eq", "status", "publishing"]
    ]);
    affected = [];
    await expect(store.finalize(post, { status: "published", errorCode: null, error: null, publishedAt: "x" })).resolves.toBe(false);
  });

  it("throws on a database error instead of reporting success", async () => {
    const sb = createFakeSupabase("service", () => ({ error: { message: "canceling statement due to statement timeout" } }));
    await expect(createSupabasePublishStore(sb.client, filter).saveProgress(post)).rejects.toThrow(/statement timeout/);
  });

  it("reads claimed rows defensively (owners can write social_posts directly)", async () => {
    const sb = createFakeSupabase("service", undefined, () => ({
      data: [
        {
          id: "p",
          merchant_id: "m",
          claim_id: "c",
          attempts: 1,
          scheduled_for: "2026-11-06T12:00:00Z",
          platforms: ["x", "x", "myspace"],
          copies: { x: { caption: 42 }, instagram: "nope" },
          visual_brief: { layout: "carousel", slides: [{ kind: "hero", headline: "h", imageUrl: "https://evil.example/a.jpg" }], paletteCue: "p" },
          media: [{ url: "javascript:alert(1)" }, { url: "https://cdn.salla.sa/ok.jpg" }],
          publish_results: { x: { status: "published", at: "t", remoteId: "1" }, instagram: { status: "hacked" } },
          remote_ids: { x: "1", evil: 3 }
        }
      ]
    }));
    const [claimed] = await createSupabasePublishStore(sb.client, filter).claimDue(5);
    expect(claimed.platforms).toEqual(["x"]);
    expect(claimed.copies.x?.caption).toBe("");
    expect(claimed.media).toEqual([{ url: "https://cdn.salla.sa/ok.jpg" }]);
    expect(claimed.results).toEqual({ x: { status: "published", at: "t", remoteId: "1" } });
    expect(claimed.remoteIds).toEqual({ x: "1" });
    expect(JSON.stringify(claimed.visualBrief)).not.toContain("evil.example");
  });
});
