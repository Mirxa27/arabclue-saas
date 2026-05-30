import { describe, expect, it } from "vitest";
import { employeeLimitForPlan, merchantCanHireEmployee } from "@/lib/billing/entitlements";
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

describe("employee hire entitlements", () => {
  it("exposes seat limits per plan", () => {
    expect(employeeLimitForPlan("lite")).toBe(0);
    expect(employeeLimitForPlan("plus")).toBe(5);
    expect(employeeLimitForPlan("pro")).toBe(15);
  });

  it("blocks hire when at seat cap", () => {
    const atCap = merchantCanHireEmployee(base, employeeLimitForPlan("plus"));
    expect(atCap.allowed).toBe(false);
    expect(atCap.reason).toMatch(/up to 5/);
  });

  it("allows hire under cap on plus", () => {
    const ok = merchantCanHireEmployee(base, 2);
    expect(ok.allowed).toBe(true);
  });
});
