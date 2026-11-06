/**
 * SW-17: the admin feature flags the dashboard stream owns are read by the code they claim to
 * control. features.billing off → new plan / AI-employee checkouts answer 503 (payments already
 * made still confirm: the confirm and webhook routes are not gated). features.wathq is covered
 * in __tests__/wathq/lookup-route.test.ts; the SEO model / residency in __tests__/seo/.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  features: { billing: true, zatca: true, wathq: true, socialOAuth: true } as Record<string, boolean>,
  settingsError: null as { message: string } | null
}));
const createBillingIntent = vi.hoisted(() => vi.fn());
const createEmployeeBillingIntent = vi.hoisted(() => vi.fn());
const reportError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/observability/error-reporter", () => ({ reportError }));
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("not used");
  }
}));
vi.mock("@/lib/billing/service", () => ({ createBillingIntent }));
vi.mock("@/lib/billing/employee-billing", () => ({ createEmployeeBillingIntent }));
vi.mock("@/lib/moyasar/client", () => ({ getPublishableKey: () => "pk_test" }));

const MERCHANT = {
  id: "00000000-0000-4000-8000-0000000017a2",
  plan: "plus",
  subscription_status: "active",
  owner_user_id: "u1"
} as unknown as Merchant;

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => ({ id: "u1" })),
    getCurrentMerchant: vi.fn(async () => MERCHANT),
    requireMerchantApi: vi.fn(async () => MERCHANT)
  };
});

import { isPlatformFeatureEnabled, PlatformFeatureDisabledError, requirePlatformFeature } from "@/lib/admin/platform-settings";
import { POST as planIntent } from "@/app/api/billing/intent/route";
import { POST as employeeIntent } from "@/app/api/employees/billing/intent/route";

beforeEach(() => {
  createBillingIntent.mockReset();
  createEmployeeBillingIntent.mockReset();
  reportError.mockReset();
  h.features = { billing: true, zatca: true, wathq: true, socialOAuth: true };
  h.settingsError = null;
  h.service = createFakeSupabase("service", (call) =>
    call.table === "platform_settings" ? (h.settingsError ? { error: h.settingsError } : { data: { value: h.features } }) : undefined
  );
});

describe("requirePlatformFeature", () => {
  it("throws a typed 503 for a switched-off feature and passes otherwise", async () => {
    h.features.billing = false;
    const err = await requirePlatformFeature("billing").catch((e) => e);
    expect(err).toBeInstanceOf(PlatformFeatureDisabledError);
    expect(err).toMatchObject({ status: 503, code: "billing_disabled", feature: "billing" });
    expect(err.message).toMatch(/Billing is temporarily disabled/);
    await expect(requirePlatformFeature("wathq")).resolves.toBeUndefined();
    expect(await isPlatformFeatureEnabled("billing")).toBe(false);
  });

  it("keeps the documented fail-open default on a failed settings read, and reports it", async () => {
    h.settingsError = { message: "timeout" };
    await expect(requirePlatformFeature("billing")).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalled();
  });
});

describe("features.billing gates new checkouts", () => {
  it("plan checkout: 503 and no intent when billing is off", async () => {
    h.features.billing = false;
    const res = await planIntent(jsonRequest("http://localhost/api/billing/intent", { plan: "pro" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Billing is temporarily disabled/);
    expect(createBillingIntent).not.toHaveBeenCalled();
  });

  it("plan checkout proceeds when billing is on", async () => {
    createBillingIntent.mockResolvedValueOnce({ given_id: "g-1" });
    const res = await planIntent(jsonRequest("http://localhost/api/billing/intent", { plan: "pro" }, { headers: { "x-forwarded-for": "198.51.100.40" } }));
    expect(res.status).toBe(200);
    expect(createBillingIntent).toHaveBeenCalledWith(MERCHANT.id, "pro");
  });

  it("AI-employee checkout: 503 and no intent when billing is off", async () => {
    h.features.billing = false;
    const res = await employeeIntent(
      jsonRequest("http://localhost/api/employees/billing/intent", { employeeId: "00000000-0000-4000-8000-0000000017e1" })
    );
    expect(res.status).toBe(503);
    expect(createEmployeeBillingIntent).not.toHaveBeenCalled();
  });
});
