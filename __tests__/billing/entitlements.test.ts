import { describe, expect, it } from "vitest";
import { merchantCanUseFeature, planIncludesFeature } from "@/lib/billing/entitlements";
import type { Merchant } from "@/lib/types/database";

const base: Merchant = {
  id: "m1",
  salla_merchant_id: null,
  salla_state: null,
  store_url: null,
  seller_name: "Test",
  vat_number: null,
  cr_number: null,
  seller_address: null,
  access_token: null,
  refresh_token: null,
  token_expires_at: null,
  plan: "plus",
  subscription_status: "active",
  owner_user_id: "u1",
  zatca_csid: null,
  zatca_onboarded_at: null,
  installed_at: null,
  uninstalled_at: null
};

describe("entitlements", () => {
  it("gates features by plan", () => {
    expect(planIncludesFeature("lite", "social")).toBe(false);
    expect(planIncludesFeature("plus", "social")).toBe(true);
    expect(planIncludesFeature("pro", "wathq")).toBe(true);
  });

  it("requires active subscription", () => {
    expect(merchantCanUseFeature({ ...base, subscription_status: "pending" }, "social")).toBe(false);
    expect(merchantCanUseFeature(base, "social")).toBe(true);
    expect(merchantCanUseFeature({ ...base, plan: "lite" }, "social")).toBe(false);
  });

  it("gates AI employees on plus+", () => {
    expect(merchantCanUseFeature({ ...base, plan: "lite", subscription_status: "active" }, "employees")).toBe(
      false
    );
    expect(merchantCanUseFeature(base, "employees")).toBe(true);
  });
});
