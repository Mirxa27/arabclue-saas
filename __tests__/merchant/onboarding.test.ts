/**
 * F01 / UI-006: /welcome no longer writes merchants from the browser. The server route
 * creates the merchant on lite/pending, never accepts plan/subscription fields, and
 * upserts the single brand kit on merchant_id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as { id: string; email?: string } | null
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("onboarding must not use the user-scoped client for writes");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => {
      if (!h.user) throw new actual.AuthError();
      return h.user;
    })
  };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { OnboardingBodySchema, splitAttributes } from "@/lib/merchant/onboarding-schema";
import { completeOnboarding } from "@/lib/merchant/onboarding";
import { CURRENT_DPA_VERSION } from "@/lib/legal/dpa";
import { POST } from "@/app/api/merchant/onboarding/route";

const USER = "00000000-0000-4000-8000-0000000000a1";
const MERCHANT = "00000000-0000-4000-8000-0000000000a2";

const validBody = {
  businessName: "بيت العود",
  vatNumber: "٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣",
  dpaAccepted: true,
  brandKit: { essence: "عود فاخر", attributes: ["أصيل", "فخم"], dialect: "khaliji" }
};

function useService(handler: FakeHandler) {
  h.service = createFakeSupabase("service", handler);
}

beforeEach(() => {
  h.user = { id: USER, email: "owner@example.test" };
});

describe("OnboardingBodySchema", () => {
  it("rejects plan, subscription, billing and routing fields instead of storing them", () => {
    for (const extra of [
      { plan: "pro" },
      { subscription_status: "active" },
      { salla_merchant_id: "777" },
      { zatca_csid: "x" }
    ]) {
      expect(OnboardingBodySchema.safeParse({ ...validBody, ...extra }).success).toBe(false);
    }
    expect(OnboardingBodySchema.safeParse({ ...validBody, brandKit: { ...validBody.brandKit, merchant_id: MERCHANT } }).success).toBe(false);
  });

  it("requires DPA acceptance and a 15-digit VAT number (Arabic-Indic digits normalised)", () => {
    expect(OnboardingBodySchema.safeParse({ ...validBody, dpaAccepted: false }).success).toBe(false);
    expect(OnboardingBodySchema.safeParse({ ...validBody, vatNumber: "30000000000000" }).success).toBe(false);
    const parsed = OnboardingBodySchema.parse(validBody);
    expect(parsed.vatNumber).toBe("300000000000003");
    expect(OnboardingBodySchema.parse({ ...validBody, vatNumber: "" }).vatNumber).toBe("");
  });

  it("splits voice attributes on Latin and Arabic commas", () => {
    expect(splitAttributes("أصيل، كريم, warm ,، أصيل")).toEqual(["أصيل", "كريم", "warm"]);
    expect(splitAttributes(Array.from({ length: 30 }, (_, i) => `a${i}`).join(","))).toHaveLength(20);
  });
});

describe("completeOnboarding", () => {
  const input = OnboardingBodySchema.parse(validBody);

  it("creates a new merchant on lite/pending with DPA consent, then upserts the brand kit", async () => {
    useService((call) => {
      if (call.table === "merchants" && call.op === "insert") return { data: { id: MERCHANT } };
    });
    const result = await completeOnboarding(h.service.client, USER, input, new Date("2026-11-06T10:00:00Z"));

    expect(result).toEqual({ merchantId: MERCHANT, created: true });
    const [insert, kit] = h.service.writes();
    expect(insert.table).toBe("merchants");
    expect(insert.payload).toMatchObject({
      owner_user_id: USER,
      plan: "lite",
      subscription_status: "pending",
      seller_name: "بيت العود",
      vat_number: "300000000000003",
      dpa_accepted_at: "2026-11-06T10:00:00.000Z",
      dpa_version: CURRENT_DPA_VERSION
    });
    expect(kit).toMatchObject({ table: "brand_kits", op: "upsert", options: { onConflict: "merchant_id" } });
    expect(kit.payload).toMatchObject({ merchant_id: MERCHANT, brand_name: "بيت العود", essence: "عود فاخر", attributes: ["أصيل", "فخم"] });
  });

  it("updates an existing merchant's profile without touching plan or subscription", async () => {
    useService((call) => {
      if (call.table === "merchants" && call.op === "select") return { data: { id: MERCHANT } };
    });
    const result = await completeOnboarding(h.service.client, USER, input);

    expect(result.created).toBe(false);
    const update = h.service.writes().find((w) => w.table === "merchants")!;
    expect(update.op).toBe("update");
    expect(update.payload).not.toHaveProperty("plan");
    expect(update.payload).not.toHaveProperty("subscription_status");
    expect(h.service.filter(update, "id")).toBe(MERCHANT);
  });

  it("recovers from a concurrent submit that created the merchant first", async () => {
    let selects = 0;
    useService((call) => {
      if (call.table === "merchants" && call.op === "select") return { data: selects++ === 0 ? null : { id: MERCHANT } };
      if (call.table === "merchants" && call.op === "insert") {
        return { error: { code: "23505", message: 'duplicate key value violates unique constraint "merchants_owner_user_id_key"' } };
      }
    });
    const result = await completeOnboarding(h.service.client, USER, input);
    expect(result).toEqual({ merchantId: MERCHANT, created: false });
    expect(h.service.writes().map((w) => `${w.table}:${w.op}`)).toEqual(["merchants:insert", "merchants:update", "brand_kits:upsert"]);
  });

  it("keeps an existing kit's essence/attributes when the voice step was left blank", async () => {
    useService((call) => {
      if (call.table === "merchants" && call.op === "select") return { data: { id: MERCHANT } };
    });
    await completeOnboarding(h.service.client, USER, OnboardingBodySchema.parse({ ...validBody, brandKit: undefined }));
    const kit = h.service.writes().find((w) => w.table === "brand_kits")!;
    expect(kit.payload).not.toHaveProperty("essence");
    expect(kit.payload).not.toHaveProperty("attributes");
  });

  it("surfaces a failed brand-kit write as a 500 (no silent success)", async () => {
    useService((call) => {
      if (call.table === "merchants" && call.op === "select") return { data: { id: MERCHANT } };
      if (call.table === "brand_kits") return { error: { code: "42P10", message: "no unique constraint" } };
    });
    await expect(completeOnboarding(h.service.client, USER, input)).rejects.toMatchObject({ status: 500 });
  });
});

describe("POST /api/merchant/onboarding", () => {
  it("requires a session (JSON 401, no redirect)", async () => {
    h.user = null;
    useService(() => undefined);
    const res = await POST(jsonRequest("http://localhost/api/merchant/onboarding", validBody));
    expect(res.status).toBe(401);
    expect(h.service.calls).toHaveLength(0);
  });

  it("rejects a body that tries to choose the plan", async () => {
    h.user = { id: "00000000-0000-4000-8000-0000000000b1" };
    useService(() => undefined);
    const res = await POST(jsonRequest("http://localhost/api/merchant/onboarding", { ...validBody, plan: "pro" }));
    expect(res.status).toBe(400);
    expect(h.service.calls).toHaveLength(0);
  });

  it("creates the merchant for the signed-in user", async () => {
    h.user = { id: "00000000-0000-4000-8000-0000000000c1" };
    useService((call) => {
      if (call.table === "merchants" && call.op === "insert") return { data: { id: MERCHANT } };
    });
    const res = await POST(jsonRequest("http://localhost/api/merchant/onboarding", validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, merchantId: MERCHANT, created: true });
    const insert = h.service.writes().find((w) => w.table === "merchants")!;
    expect(insert.payload).toMatchObject({ owner_user_id: "00000000-0000-4000-8000-0000000000c1", plan: "lite" });
  });
});
