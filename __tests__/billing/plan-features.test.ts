/**
 * critic-25: every plan feature line is backed by what the product enforces — a module the
 * plan's entitlements include, an "everything in <lower plan>" whose entitlements are a subset,
 * a quota read from the constant the API enforces, or an allow-listed non-gated service — and
 * every line is bilingual. No unenforced claims (invoice caps, "Arabic dashboard", call quotas).
 */
import { describe, expect, it } from "vitest";
import { BILLING_PLANS, SEO_MONTHLY_GENERATIONS, type BillingPlan, type PlanFeature } from "@/lib/billing/plans";
import { PLAN_EMPLOYEE_LIMITS, planIncludesFeature, type ProductFeature } from "@/lib/billing/entitlements";
import { seoMonthlyLimit } from "@/lib/seo/generate";

const PLANS = Object.keys(BILLING_PLANS) as BillingPlan[];
const ALL_FEATURES: ProductFeature[] = ["zatca", "social", "voice", "seo", "wathq", "employees"];
const ALLOWED_SERVICES = new Set(["email_support"]);
const ORDER: BillingPlan[] = ["lite", "plus", "pro"];

/** Every module a plan's card promises, following "everything in …" lines. */
function promisedModules(plan: BillingPlan): Set<ProductFeature> {
  const out = new Set<ProductFeature>();
  for (const f of BILLING_PLANS[plan].featureList) {
    if (f.kind === "module") out.add(f.feature);
    if (f.kind === "includes") for (const m of promisedModules(f.plan)) out.add(m);
  }
  return out;
}

describe("plan features match enforcement", () => {
  it.each(PLANS)("%s: every line maps to an entitlement, a lower plan, an enforced quota or an allow-listed service", (plan) => {
    for (const f of BILLING_PLANS[plan].featureList as PlanFeature[]) {
      expect(f.ar.trim(), `${plan}: Arabic label`).not.toBe("");
      expect(f.en.trim(), `${plan}: English label`).not.toBe("");
      switch (f.kind) {
        case "module":
          expect(planIncludesFeature(plan, f.feature), `${plan} advertises ${f.feature}`).toBe(true);
          break;
        case "includes":
          expect(ORDER.indexOf(f.plan)).toBeLessThan(ORDER.indexOf(plan));
          for (const feature of ALL_FEATURES) {
            if (planIncludesFeature(f.plan, feature)) expect(planIncludesFeature(plan, feature)).toBe(true);
          }
          break;
        case "quota":
          if (f.quota === "seo_generations") {
            expect(planIncludesFeature(plan, "seo")).toBe(true);
            expect(f.limit).toBe(SEO_MONTHLY_GENERATIONS[plan]);
            expect(f.limit).toBe(seoMonthlyLimit(plan)); // the number POST /api/seo/generate enforces
          } else {
            expect(planIncludesFeature(plan, "employees")).toBe(true);
            expect(f.limit).toBe(PLAN_EMPLOYEE_LIMITS[plan]);
          }
          expect(f.en).toContain(f.limit.toLocaleString("en-US"));
          break;
        case "service":
          expect(ALLOWED_SERVICES.has(f.service)).toBe(true);
          break;
      }
    }
  });

  it.each(PLANS)("%s: the card promises exactly the modules the plan includes", (plan) => {
    const included = ALL_FEATURES.filter((f) => planIncludesFeature(plan, f));
    expect([...promisedModules(plan)].sort()).toEqual([...included].sort());
  });

  it("keeps the English string list in sync for existing consumers", () => {
    for (const plan of PLANS) expect(BILLING_PLANS[plan].features).toEqual(BILLING_PLANS[plan].featureList.map((f) => f.en));
  });

  it("makes no unenforced claims", () => {
    const text = PLANS.flatMap((p) => BILLING_PLANS[p].featureList.flatMap((f) => [f.ar, f.en])).join("\n");
    expect(text).not.toMatch(/invoices \/ month|Arabic dashboard|calls\/mo|Priority support|Multi-channel/i);
    expect(text).not.toMatch(/٢٠٠ فاتورة/);
  });

  it("SEO quotas exist only where the plan includes SEO", () => {
    for (const plan of ["lite", "plus", "pro", "enterprise"] as const) {
      expect(SEO_MONTHLY_GENERATIONS[plan] > 0).toBe(planIncludesFeature(plan, "seo"));
    }
  });
});
