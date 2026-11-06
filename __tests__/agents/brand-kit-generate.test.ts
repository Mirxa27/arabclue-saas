/**
 * UI-026 / UI-006: the onboarding "AI Generate Voice" action calls a real model
 * through POST /api/brand-kit/generate (auth + rate limit + honest 503 when no provider
 * is configured), and saving the brand kit accepts kits stored with a NULL essence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  serverClient: null as unknown as FakeSupabase
}));
const aiStructured = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/providers", () => ({ aiStructured }));
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.serverClient.client,
  getServiceSupabase: () => {
    throw new Error("brand kits are merchant content: written through the user's session");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => {
      if (!h.user) throw new actual.AuthError();
      return h.user;
    }),
    getCurrentMerchant: vi.fn(async () => ({ id: "00000000-0000-4000-8000-0000000000a2" }))
  };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { normalizeGeneratedKit } from "@/lib/agents/brand-kit-generator";
import { POST as generate } from "@/app/api/brand-kit/generate/route";
import { POST as saveKit } from "@/app/api/brand-kit/route";

let seq = 0;
const signIn = () => {
  seq += 1;
  h.user = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}` };
};
const call = (body: unknown) => generate(jsonRequest("http://localhost/api/brand-kit/generate", body));

beforeEach(() => {
  aiStructured.mockReset();
  process.env.OPENAI_API_KEY = "sk-test";
  h.serverClient = createFakeSupabase("user");
  signIn();
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("normalizeGeneratedKit", () => {
  it("trims, de-duplicates and caps what the model returns", () => {
    const kit = normalizeGeneratedKit({
      essence: "  عطور   عود فاخرة للأسر السعودية  ",
      attributes: ["- أصيل", "• فخم", "أصيل", "دافئ", "كريم", "عصري", "مبتكر", "إضافي"],
      favor_words: ["ضيافة", ""],
      avoid_words: Array.from({ length: 12 }, (_, i) => `w${i}`),
      dialect: "khaliji"
    });
    expect(kit.essence).toBe("عطور عود فاخرة للأسر السعودية");
    expect(kit.attributes).toEqual(["أصيل", "فخم", "دافئ", "كريم", "عصري", "مبتكر"]);
    expect(kit.favor_words).toEqual(["ضيافة"]);
    expect(kit.avoid_words).toHaveLength(8);
  });
});

describe("POST /api/brand-kit/generate", () => {
  it("returns the model's suggestion for the store name", async () => {
    aiStructured.mockResolvedValueOnce({
      essence: "قهوة سعودية مختصة محمصة محلياً لعشاق الهيل",
      attributes: ["كريم", "ودود", "أصيل"],
      favor_words: ["هيل"],
      avoid_words: ["رخيص"],
      dialect: "khaliji"
    });
    const res = await call({ brand_name: "محمصة الديرة" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kit: { essence: string; attributes: string[] } };
    expect(body.kit.essence).toContain("قهوة");
    expect(body.kit.attributes).toEqual(["كريم", "ودود", "أصيل"]);
    const [, opts] = aiStructured.mock.calls[0];
    expect(opts.prompt).toContain(JSON.stringify("محمصة الديرة"));
  });

  it("is honest when no AI provider is configured (503) and never returns canned text", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await call({ brand_name: "بيت العود" });
    expect(res.status).toBe(503);
    expect(aiStructured).not.toHaveBeenCalled();
  });

  it("maps provider failures to 502", async () => {
    aiStructured.mockRejectedValueOnce(new Error("upstream timeout"));
    const res = await call({ brand_name: "بيت العود" });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).not.toContain("upstream");
  });

  it("requires a session and validates input", async () => {
    h.user = null;
    expect((await call({ brand_name: "x" })).status).toBe(401);
    signIn();
    expect((await call({ brand_name: "" })).status).toBe(400);
    expect((await call({ brand_name: "x".repeat(121) })).status).toBe(400);
  });

  it("is rate-limited per user", async () => {
    aiStructured.mockResolvedValue({ essence: "متجر", attributes: ["أصيل"], favor_words: [], avoid_words: [], dialect: "msa" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call({ brand_name: "Store" })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("POST /api/brand-kit", () => {
  it("accepts a kit whose stored essence is NULL and upserts on merchant_id", async () => {
    const res = await saveKit(
      jsonRequest("http://localhost/api/brand-kit", {
        id: "kit-1",
        merchant_id: "someone-else",
        brand_name: "Brand",
        essence: null,
        attributes: ["warm"]
      })
    );
    expect(res.status).toBe(200);
    const [upsert] = h.serverClient.writes();
    expect(upsert).toMatchObject({ table: "brand_kits", op: "upsert", options: { onConflict: "merchant_id" } });
    expect(upsert.payload).toMatchObject({ merchant_id: "00000000-0000-4000-8000-0000000000a2", essence: "" });
    expect(upsert.payload).not.toHaveProperty("id");
  });

  it("reports a failed save as a 500 without the raw database message", async () => {
    h.serverClient = createFakeSupabase("user", () => ({ error: { code: "42P10", message: "there is no unique constraint matching" } }));
    const res = await saveKit(jsonRequest("http://localhost/api/brand-kit", { brand_name: "Brand" }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).not.toContain("unique constraint");
  });
});
