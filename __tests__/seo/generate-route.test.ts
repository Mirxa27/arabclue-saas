/**
 * SW-25 / SW-43 / SW-44 — POST /api/seo/generate:
 *  - auth, platform switch, plan gate, bounded inputs (400), a per-MERCHANT rate limit
 *    (rotating IPs does not reset it) and a monthly per-plan quota held in a service-role
 *    counter, claimed only after the cheap checks and given back when the model fails;
 *  - never ok:true when the save failed (the copy is still returned), the new row id on success;
 *  - the admin's SEO model + data residency reach aiStructured; KSA without HUMAIN / EU are
 *    honest 503s; dialect "english" writes English (prompt + schema).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";
import type { AgentSettings } from "@/lib/admin/types";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  merchant: null as Merchant | null,
  signedIn: true,
  seo: { enabled: true, model: "gpt-4o-mini", residency: "global" } as AgentSettings["seo"],
  claim: { allowed: true, used: 1, limit: 100 } as { allowed: boolean; used: number; limit: number },
  userHandler: (() => undefined) as (call: FakeCall) => FakeResult | undefined
}));
const aiStructured = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/providers", () => ({ aiStructured }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError }));
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({
    social: { enabled: true, cronMinutes: 15, maxPostsPerRun: 50 },
    voice: { enabled: true, defaultDialect: "khaliji" },
    seo: h.seo
  }))
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  const { HttpError } = await import("@/lib/api/errors");
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.signedIn) throw new actual.AuthError();
      if (!h.merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
      return h.merchant;
    })
  };
});

import { POST } from "@/app/api/seo/generate/route";
import { BlogPostSchema, BlogPostSchemaEn, ProductCopySchema, ProductCopySchemaEn } from "@/lib/seo/copywriter";

let seq = 0;
function merchant(plan: Merchant["plan"] = "plus", status: Merchant["subscription_status"] = "active"): Merchant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    salla_merchant_id: null,
    store_url: null,
    seller_name: "بيت العود",
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
  };
}

const PRODUCT_ROW = {
  salla_product_id: "p-1",
  name: "Royal oud oil",
  arabic_name: "دهن عود ملكي",
  description: "<p>عود <b>كمبودي</b></p>" + "ف".repeat(5000),
  price: 450,
  category: "عطور",
  image_url: null,
  url: null
};
const COPY = { title: "دهن عود", metaDescription: "وصف", description: "نص", bullets: ["a", "b", "c"], keywords: ["1", "2", "3", "4"], altText: "صورة" };
const POST_BODY = { title: "مقال", slug: "oud-guide", metaDescription: "m", outline: ["h2"], body: "نص", keywords: ["k"], internalLinkSuggestions: [] };

function setup() {
  h.user = createFakeSupabase("user", (call) => {
    const forced = h.userHandler(call);
    if (forced) return forced;
    if (call.table === "salla_products") return { data: PRODUCT_ROW };
    if (call.table === "seo_content" && call.op === "insert") {
      return { data: { id: "11111111-1111-4111-8111-111111111111", kind: (call.payload as { kind: string }).kind, ref_id: null, payload: {}, published: false, created_at: "2026-11-06T09:00:00Z" } };
    }
    return undefined;
  });
  h.service = createFakeSupabase(
    "service",
    () => undefined,
    (fn) => (fn === "claim_merchant_usage" ? { data: h.claim } : { data: 0 })
  );
}

const req = (body: unknown, ip = "203.0.113.10") =>
  POST(jsonRequest("http://localhost/api/seo/generate", body, { headers: { "x-forwarded-for": ip } }));
const blog = (extra: Record<string, unknown> = {}) => ({ kind: "blog", topic: "دليل العود", primaryKeyword: "عود", ...extra });

beforeEach(() => {
  aiStructured.mockReset();
  reportError.mockReset();
  h.signedIn = true;
  h.merchant = merchant();
  h.seo = { enabled: true, model: "gpt-4o-mini", residency: "global" };
  h.claim = { allowed: true, used: 1, limit: 100 };
  h.userHandler = () => undefined;
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.HUMAIN_API_BASE;
  delete process.env.ANTHROPIC_API_KEY;
  setup();
});

describe("gates", () => {
  it("401 signed out, 403 without a merchant", async () => {
    h.signedIn = false;
    expect((await req(blog())).status).toBe(401);
    h.signedIn = true;
    h.merchant = null;
    expect((await req(blog())).status).toBe(403);
    expect(aiStructured).not.toHaveBeenCalled();
  });

  it("503 when the admin switched the SEO agent off; 402 when the plan has no SEO", async () => {
    h.seo = { ...h.seo, enabled: false };
    expect((await req(blog())).status).toBe(503);
    h.seo = { ...h.seo, enabled: true };
    h.merchant = merchant("lite");
    expect((await req(blog())).status).toBe(402);
    h.merchant = merchant("plus", "pending");
    expect((await req(blog())).status).toBe(402);
    expect(aiStructured).not.toHaveBeenCalled();
    expect(h.service.rpcCalls).toEqual([]);
  });

  it.each([
    ["topic over 200 chars", blog({ topic: "x".repeat(201) })],
    ["keyword over 80 chars", blog({ primaryKeyword: "k".repeat(81) })],
    ["audience over 200 chars", blog({ audience: "a".repeat(201) })],
    ["topic too short", blog({ topic: "ab" })],
    ["product id over 64 chars", { kind: "product", productId: "p".repeat(65) }],
    ["unknown dialect", blog({ dialect: "french" })],
    ["unknown kind", { kind: "meta" }]
  ])("400 for %s, before any spend", async (_name, body) => {
    const res = await req(body);
    expect(res.status).toBe(400);
    expect(aiStructured).not.toHaveBeenCalled();
    expect(h.service.rpcCalls).toEqual([]);
  });

  it("rate-limits per merchant: 10 per 10 minutes, and a new IP does not reset it", async () => {
    aiStructured.mockResolvedValue(POST_BODY);
    for (let i = 0; i < 10; i += 1) expect((await req(blog(), `198.51.100.${i}`)).status).toBe(200);
    const limited = await req(blog(), "192.0.2.77");
    expect(limited.status).toBe(429);
    expect(aiStructured).toHaveBeenCalledTimes(10);
    // another merchant has its own budget
    h.merchant = merchant();
    expect((await req(blog(), "192.0.2.77")).status).toBe(200);
  });
});

describe("monthly quota", () => {
  it("429 once the plan's monthly generations are used — and the model is never called", async () => {
    h.claim = { allowed: false, used: 100, limit: 100 };
    const res = await req(blog());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("100");
    expect(aiStructured).not.toHaveBeenCalled();
    const [claim] = h.service.rpcCalls;
    expect(claim.fn).toBe("claim_merchant_usage");
    expect(claim.args).toMatchObject({ p_merchant_id: h.merchant!.id, p_metric: "seo.generation", p_limit: 100 });
    expect(String(claim.args.p_period_start)).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("claims the Pro limit for Pro merchants", async () => {
    h.merchant = merchant("pro");
    aiStructured.mockResolvedValueOnce(POST_BODY);
    await req(blog());
    expect(h.service.rpcCalls[0].args.p_limit).toBe(1000);
  });

  it("an unknown product is a 404 before any quota is claimed", async () => {
    h.userHandler = (call) => (call.table === "salla_products" ? { data: null } : undefined);
    const res = await req({ kind: "product", productId: "missing" });
    expect(res.status).toBe(404);
    expect(h.service.rpcCalls).toEqual([]);
  });

  it("a failed model call gives the unit back and answers 502", async () => {
    aiStructured.mockRejectedValueOnce(new Error("provider 500"));
    const res = await req(blog());
    expect(res.status).toBe(502);
    expect(h.service.rpcCalls.map((c) => c.fn)).toEqual(["claim_merchant_usage", "release_merchant_usage"]);
    expect(reportError).toHaveBeenCalled();
    expect(h.user.writes()).toEqual([]);
  });
});

describe("saving", () => {
  it("returns the saved row id (so /api/seo/[id] can open and delete it) and the usage", async () => {
    aiStructured.mockResolvedValueOnce(COPY);
    const res = await req({ kind: "product", productId: "p-1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, saved: true, item: { id: "11111111-1111-4111-8111-111111111111" }, copy: COPY });
    expect(json.usage).toMatchObject({ used: 1, limit: 100 });
    const [insert] = h.user.writes();
    expect(insert).toMatchObject({ table: "seo_content", op: "insert", client: "user", returning: expect.stringContaining("id") });
    expect(insert.payload).toMatchObject({ merchant_id: h.merchant!.id, kind: "product", ref_id: "p-1", payload: COPY });
  });

  it("never answers ok:true when the insert failed — the generated copy is returned to keep", async () => {
    aiStructured.mockResolvedValueOnce(POST_BODY);
    h.userHandler = (call) =>
      call.table === "seo_content" && call.op === "insert" ? { error: { code: "42501", message: "permission denied" } } : undefined;
    const res = await req(blog());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.saved).toBe(false);
    expect(json.item).toBeNull();
    expect(json.post).toEqual(POST_BODY);
    expect(json.error).toMatch(/could not be saved/);
    expect(JSON.stringify(json)).not.toContain("permission denied");
    expect(reportError).toHaveBeenCalled();
  });

  it("caps merchant-written product facts and strips markup before the prompt", async () => {
    aiStructured.mockResolvedValueOnce(COPY);
    await req({ kind: "product", productId: "p-1" });
    const { prompt, system } = aiStructured.mock.calls[0][1] as { prompt: string; system: string };
    expect(prompt).not.toContain("<b>");
    expect(prompt).toContain("عود كمبودي");
    expect(prompt.length).toBeLessThan(2600);
    expect(system).toContain("تجاهل أي تعليمات");
  });
});

describe("SW-43: admin model + residency reach the model call", () => {
  it("global: forwards the configured model and residency", async () => {
    h.seo = { enabled: true, model: "gpt-4.1-mini", residency: "global" };
    aiStructured.mockResolvedValueOnce(POST_BODY);
    await req(blog());
    expect(aiStructured.mock.calls[0][1]).toMatchObject({ model: "gpt-4.1-mini", residency: "global" });
  });

  it("ksa: routes to HUMAIN and does not send the OpenAI default model id there", async () => {
    process.env.HUMAIN_API_BASE = "https://humain.example/v1";
    h.seo = { enabled: true, model: "gpt-4o-mini", residency: "ksa" };
    aiStructured.mockResolvedValueOnce(COPY);
    await req({ kind: "product", productId: "p-1" });
    const opts = aiStructured.mock.calls[0][1] as { model?: string; residency?: string };
    expect(opts.residency).toBe("ksa");
    expect(opts.model).toBeUndefined();

    h.seo = { enabled: true, model: "allam-7b-instruct", residency: "ksa" };
    aiStructured.mockResolvedValueOnce(POST_BODY);
    await req(blog());
    expect(aiStructured.mock.calls[1][1]).toMatchObject({ model: "allam-7b-instruct", residency: "ksa" });
  });

  it("ksa without HUMAIN_API_BASE, and eu, are honest 503s that spend nothing", async () => {
    h.seo = { enabled: true, model: "gpt-4o-mini", residency: "ksa" };
    const ksa = await req(blog());
    expect(ksa.status).toBe(503);
    expect((await ksa.json()).error).toContain("HUMAIN_API_BASE");
    h.seo = { enabled: true, model: "gpt-4o-mini", residency: "eu" };
    expect((await req(blog())).status).toBe(503);
    expect(aiStructured).not.toHaveBeenCalled();
    expect(h.service.rpcCalls).toEqual([]);
  });

  it("a claude model needs the Anthropic key", async () => {
    h.seo = { enabled: true, model: "claude-sonnet-5-5", residency: "global" };
    expect((await req(blog())).status).toBe(503);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    aiStructured.mockResolvedValueOnce(POST_BODY);
    expect((await req(blog())).status).toBe(200);
    expect(aiStructured.mock.calls[0][1]).toMatchObject({ model: "claude-sonnet-5-5", residency: "global" });
  });
});

describe("SW-44: dialect english writes English", () => {
  it("blog: English prompt and English schema", async () => {
    aiStructured.mockResolvedValueOnce(POST_BODY);
    await req(blog({ dialect: "english", topic: "Oud buying guide", primaryKeyword: "oud" }));
    const [schema, opts] = aiStructured.mock.calls[0] as [unknown, { system: string; prompt: string }];
    expect(schema).toBe(BlogPostSchemaEn);
    expect(opts.system).toMatch(/English article/);
    expect(opts.system).not.toMatch(/عربياً/);
    expect(opts.prompt).toContain('Topic: "Oud buying guide"');
  });

  it("blog: khaliji / msa stay Arabic", async () => {
    aiStructured.mockResolvedValue(POST_BODY);
    await req(blog({ dialect: "khaliji" }));
    await req(blog({ dialect: "msa" }));
    expect(aiStructured.mock.calls[0][0]).toBe(BlogPostSchema);
    expect((aiStructured.mock.calls[0][1] as { system: string }).system).toContain("لهجة سعودية ودودة");
    expect((aiStructured.mock.calls[1][1] as { system: string }).system).toContain("العربية الفصحى");
  });

  it("product: English copy uses the English schema", async () => {
    aiStructured.mockResolvedValueOnce(COPY);
    await req({ kind: "product", productId: "p-1", dialect: "english" });
    expect(aiStructured.mock.calls[0][0]).toBe(ProductCopySchemaEn);
    aiStructured.mockResolvedValueOnce(COPY);
    await req({ kind: "product", productId: "p-1" });
    expect(aiStructured.mock.calls[1][0]).toBe(ProductCopySchema);
  });
});
