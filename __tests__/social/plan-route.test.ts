/**
 * POST /api/social/plan (lib/social/plan-service.ts): switches, plan gate, per-merchant rate
 * limit, single flight + daily quota, connected platforms, drafts (SW-31, SW-32, SW-46).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";
import type { GeneratedPost, PlanStats, generateSocialPlan } from "@/lib/social/plan";

const h = vi.hoisted(() => ({ socialEnabled: true }));
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({
    social: { enabled: h.socialEnabled, cronMinutes: 15, maxPostsPerRun: 50 },
    voice: { enabled: true, defaultDialect: "khaliji" },
    seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
  }))
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { handlePlanRequest } from "@/lib/social/plan-service";

function merchant(plan: Merchant["plan"] = "plus", status: Merchant["subscription_status"] = "active"): Merchant {
  return {
    id: randomUUID(), // fresh id per test: the rate limiter is keyed by merchant
    salla_merchant_id: null,
    store_url: null,
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    token_expires_at: null,
    plan,
    subscription_status: status,
    owner_user_id: "u1",
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null
  } as Merchant;
}

type World = {
  kit: Record<string, unknown> | null;
  drafts: number;
  channels: Array<{ platform: string; access_token_encrypted: string | null; token_invalid_at: string | null }>;
  run: { run_id: string | null; outcome: string; retry_after_seconds: number | null };
  postsInsertError?: FakeResult["error"];
};

function clients(world: World) {
  const user = createFakeSupabase("user", (call: FakeCall) => {
    if (call.table === "brand_kits") return { data: world.kit };
    if (call.table === "social_posts" && call.op === "select") return { count: world.drafts };
    if (call.table === "salla_products") return { data: [] };
    if (call.table === "social_plans" && call.op === "insert") return { data: { id: "plan-1" } };
    if (call.table === "social_posts" && call.op === "insert") return { error: world.postsInsertError ?? null };
    return undefined;
  });
  const service = createFakeSupabase(
    "service",
    (call) => (call.table === "social_channels" ? { data: world.channels } : undefined),
    (fn) => (fn === "social_begin_plan_run" ? { data: [world.run] } : undefined)
  );
  return { user, service };
}

const KIT = { brand_name: "Oud House", essence: "oud", attributes: ["warm"], dialect: "khaliji" };
const CONNECTED = [
  { platform: "x", access_token_encrypted: "enc:v1:x", token_invalid_at: null },
  { platform: "instagram", access_token_encrypted: "enc:v1:ig", token_invalid_at: null },
  { platform: "tiktok", access_token_encrypted: "enc:v1:tt", token_invalid_at: null },
  { platform: "linkedin", access_token_encrypted: "enc:v1:li", token_invalid_at: "2026-11-01T00:00:00Z" }
];

const generated: GeneratedPost = {
  post: { scheduledFor: "2026-11-08T06:00:00.000Z", platforms: ["instagram", "x"], goal: "conversion", productIds: ["p1"], hook: "h", rationale: "r" },
  copies: { instagram: { caption: "ig", altText: "", cta: "", hashtags: [] }, x: { caption: "x", altText: "", cta: "", hashtags: [] } },
  visualBrief: null,
  productIds: ["p1"],
  media: [{ url: "https://cdn.salla.sa/p1.jpg", productId: "p1" }]
};
const stats = (): PlanStats => ({
  requested: 21,
  planned: 1,
  kept: 1,
  dropped: { invalidTime: 0, outsideWindow: 0, noPlatform: 0, noImage: 0, overTarget: 0, overBudget: 0, generationFailed: 0 },
  instagramRemoved: 0,
  xShortened: 0,
  llmCalls: 4
});

const request = (body: unknown) =>
  new NextRequest("http://localhost/api/social/plan", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body)
  });

let world: World;
beforeEach(() => {
  h.socialEnabled = true;
  world = { kit: KIT, drafts: 0, channels: CONNECTED, run: { run_id: "run-1", outcome: "started", retry_after_seconds: null } };
});

async function call(
  m: Merchant,
  body: unknown,
  generate = vi.fn<typeof generateSocialPlan>(async () => ({ posts: [generated], stats: stats(), window: {} as never }))
) {
  const c = clients(world);
  const res = await handlePlanRequest(request(body), m, { userClient: c.user.client, serviceClient: c.service.client, generate });
  return { res, json: await res.json(), ...c, generate };
}

describe("POST /api/social/plan — gates", () => {
  it("honours the admin kill switch and the plan before any work", async () => {
    h.socialEnabled = false;
    let r = await call(merchant(), {});
    expect(r.res.status).toBe(503);
    h.socialEnabled = true;
    r = await call(merchant("lite"), {});
    expect(r.res.status).toBe(402);
    r = await call(merchant("pro", "canceled"), {});
    expect(r.res.status).toBe(402);
    expect(r.generate).not.toHaveBeenCalled();
    expect(r.service.rpcCalls).toHaveLength(0);
  });

  it("rejects a request one plan cannot hold with a 400 before any LLM spend", async () => {
    const r = await call(merchant(), { horizonDays: 60, postsPerWeek: 14 });
    expect(r.res.status).toBe(400);
    expect(r.json.error).toMatch(/at most 40/);
    expect(r.generate).not.toHaveBeenCalled();
  });

  it("plans only for connected, publishable channels — and says why a requested one is refused", async () => {
    let r = await call(merchant(), {});
    expect(r.generate.mock.calls[0][0]).toMatchObject({ platforms: ["instagram", "x"], horizonDays: 30, postsPerWeek: 5 });

    r = await call(merchant(), { platforms: ["tiktok"] });
    expect(r.res.status).toBe(400);
    expect(r.json.code).toBe("platform_unsupported");
    r = await call(merchant(), { platforms: ["linkedin"] });
    expect(r.json.code).toBe("platform_reconnect_required");
    world.channels = [];
    r = await call(merchant(), {});
    expect(r.json.code).toBe("no_connected_platforms");
    world.channels = CONNECTED;
    world.kit = null;
    r = await call(merchant(), {});
    expect(r.json.code).toBe("brand_kit_missing");
  });
});

describe("POST /api/social/plan — throttling and single flight", () => {
  it("allows one generation per merchant per 5 minutes", async () => {
    const m = merchant();
    expect((await call(m, {})).res.status).toBe(200);
    const second = await call(m, { replaceDrafts: true });
    expect(second.res.status).toBe(429);
    expect(second.generate).not.toHaveBeenCalled();
    // another merchant is not affected
    expect((await call(merchant(), {})).res.status).toBe(200);
  });

  it("refuses while a generation is running and when the daily quota is spent", async () => {
    world.run = { run_id: null, outcome: "busy", retry_after_seconds: 30 };
    let r = await call(merchant(), {});
    expect(r.res.status).toBe(409);
    expect(r.json.code).toBe("plan_in_progress");

    world.run = { run_id: null, outcome: "quota_exceeded", retry_after_seconds: 7200 };
    r = await call(merchant(), {});
    expect(r.res.status).toBe(429);
    expect(r.json.code).toBe("plan_quota_exceeded");
    expect(r.res.headers.get("Retry-After")).toBe("7200");
    expect(r.generate).not.toHaveBeenCalled();
    expect(r.service.rpcCalls[0].args).toMatchObject({ p_daily_quota: 5, p_stale_seconds: 600 });
  });
});

describe("POST /api/social/plan — drafts", () => {
  it("inserts generated posts as drafts with their catalog media, and closes the run", async () => {
    const r = await call(merchant(), {});
    expect(r.res.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, count: 1, status: "draft", planId: "plan-1" });
    const insert = r.user.writes().find((c) => c.table === "social_posts" && c.op === "insert")!;
    expect(insert.payload).toEqual([
      expect.objectContaining({
        status: "draft",
        plan_id: "plan-1",
        scheduled_for: "2026-11-08T06:00:00.000Z",
        platforms: ["instagram", "x"],
        product_ids: ["p1"],
        media: [{ url: "https://cdn.salla.sa/p1.jpg", productId: "p1" }]
      })
    ]);
    const finish = r.service.writes().find((c) => c.table === "social_plan_runs")!;
    expect(finish.payload).toMatchObject({ status: "succeeded", plan_id: "plan-1", post_count: 1, llm_calls: 4 });
  });

  it("asks before stacking a second grid of unapproved drafts, and replaces them on request", async () => {
    world.drafts = 12;
    let r = await call(merchant(), {});
    expect(r.res.status).toBe(409);
    expect(r.json).toMatchObject({ code: "drafts_exist", drafts: 12 });
    expect(r.generate).not.toHaveBeenCalled();

    r = await call(merchant(), { replaceDrafts: true });
    expect(r.res.status).toBe(200);
    const writes = r.user.writes();
    const cancel = writes.findIndex((c) => c.table === "social_posts" && c.op === "update");
    const insert = writes.findIndex((c) => c.table === "social_posts" && c.op === "insert");
    expect(writes[cancel]).toMatchObject({ payload: { status: "canceled", error_code: "replaced" } });
    expect(writes[cancel].filters).toContainEqual(["eq", "status", "draft"]);
    expect(cancel).toBeLessThan(insert); // only after the new plan exists
  });

  it("fails loudly (and closes the run) when the posts cannot be saved", async () => {
    world.postsInsertError = { code: "23514", message: "violates check constraint" };
    const c = clients(world);
    const generate = vi.fn<typeof generateSocialPlan>(async () => ({ posts: [generated], stats: stats(), window: {} as never }));
    await expect(
      handlePlanRequest(request({}), merchant(), { userClient: c.user.client, serviceClient: c.service.client, generate })
    ).rejects.toMatchObject({ status: 500 });
    expect(c.user.writes().some((w) => w.table === "social_plans" && w.op === "delete")).toBe(true);
    expect(c.service.writes().find((w) => w.table === "social_plan_runs")?.payload).toMatchObject({ status: "failed" });
  });
});
