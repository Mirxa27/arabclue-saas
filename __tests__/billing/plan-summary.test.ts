/**
 * UI-033: onboarding plan/team copy is derived from plans.ts + entitlements.ts, so it
 * cannot advertise modules the API refuses (e.g. SEO on Lite).
 */
import { describe, expect, it } from "vitest";
import { personaAvailableOnPlan, planCards, planModules } from "@/lib/billing/plan-summary";
import { BILLING_PLANS, formatHalalas } from "@/lib/billing/plans";
import { planIncludesFeature } from "@/lib/billing/entitlements";

describe("plan summary", () => {
  it("lists exactly the modules each plan's entitlements include", () => {
    expect(planModules("lite").map((m) => m.feature)).toEqual(["zatca"]);
    expect(planModules("plus").map((m) => m.feature)).toEqual(["zatca", "social", "voice", "seo", "employees"]);
    expect(planModules("pro").map((m) => m.feature)).toEqual(["zatca", "social", "voice", "seo", "wathq", "employees"]);
    for (const m of planModules("pro")) expect(m.ar && m.en).toBeTruthy();
  });

  it("prices cards from BILLING_PLANS", () => {
    const cards = planCards();
    expect(cards.map((c) => c.id)).toEqual(["lite", "plus", "pro"]);
    for (const card of cards) {
      expect(card.price).toBe(formatHalalas(BILLING_PLANS[card.id].amountHalalas));
      expect(card.features).toEqual(BILLING_PLANS[card.id].features);
    }
    expect(cards.find((c) => c.id === "lite")!.employeeSeats).toBe(0);
  });

  it("marks a persona available only when its module is in the plan", () => {
    expect(personaAvailableOnPlan("seo", "lite")).toBe(false);
    expect(personaAvailableOnPlan("analyst", "lite")).toBe(false);
    expect(personaAvailableOnPlan("social", "plus")).toBe(true);
    expect(personaAvailableOnPlan("analyst", "plus")).toBe(planIncludesFeature("plus", "employees"));
    expect(personaAvailableOnPlan("onboarding", "pro")).toBe(false);
  });
});
