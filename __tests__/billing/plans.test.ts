import { describe, it, expect } from "vitest";
import { BILLING_PLANS, getPlan, formatHalalas } from "@/lib/billing/plans";

/**
 * Guards against drift between the in-code pricing (the source of truth used by
 * Moyasar charges) and the published Salla listing: Lite 99 / Plus 299 / Pro 599
 * SAR per month (docs/SALLA-APP-LISTING.md).
 */
describe("billing plans match the published Salla listing", () => {
  it("prices the three tiers exactly as listed", () => {
    expect(BILLING_PLANS.lite.amountHalalas).toBe(9900); // 99.00 SAR
    expect(BILLING_PLANS.plus.amountHalalas).toBe(29900); // 299.00 SAR
    expect(BILLING_PLANS.pro.amountHalalas).toBe(59900); // 599.00 SAR
  });

  it("charges in SAR and meets the Moyasar 100-halala minimum", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(plan.currency).toBe("SAR");
      expect(plan.amountHalalas).toBeGreaterThanOrEqual(100);
    }
  });

  it("every plan carries a name, description and at least one feature", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(plan.name).toBeTruthy();
      expect(plan.description).toBeTruthy();
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  it("getPlan resolves a definition and formatHalalas renders SAR", () => {
    expect(getPlan("pro").name).toBe("Pro");
    expect(formatHalalas(29900)).toBe("299.00 SAR");
  });
});
