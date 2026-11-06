/**
 * What each plan includes, derived from the billing source of truth (plans.ts prices,
 * entitlements.ts feature gates and seat limits) so marketing/onboarding copy cannot
 * drift from what the API actually allows. Client-safe.
 */
import type { MerchantPlan } from "@/lib/types/database";
import { BILLING_PLANS, formatHalalas, type BillingPlan } from "@/lib/billing/plans";
import { employeeLimitForPlan, planIncludesFeature, type ProductFeature } from "@/lib/billing/entitlements";
import { AGENT_FEATURE, isAgentRole } from "@/lib/agents/settings";

export const FEATURE_LABELS: Record<ProductFeature, { ar: string; en: string }> = {
  zatca: { ar: "الفوترة الإلكترونية (زاتكا)", en: "ZATCA e-invoicing" },
  social: { ar: "وكيل التواصل الاجتماعي", en: "Social media agent" },
  voice: { ar: "الوكيل الصوتي للمكالمات", en: "Voice call agent" },
  seo: { ar: "كتابة محتوى السيو بالعربية", en: "Arabic SEO copy" },
  wathq: { ar: "بيانات السجل التجاري من واثق", en: "Wathq CR intelligence" },
  employees: { ar: "سوق الموظفين الأذكياء", en: "AI employees marketplace" }
};

const FEATURE_ORDER: ProductFeature[] = ["zatca", "social", "voice", "seo", "wathq", "employees"];

export type PlanModule = { feature: ProductFeature; ar: string; en: string };

export function planModules(plan: MerchantPlan): PlanModule[] {
  return FEATURE_ORDER.filter((f) => planIncludesFeature(plan, f)).map((feature) => ({
    feature,
    ...FEATURE_LABELS[feature]
  }));
}

export type PlanCard = {
  id: BillingPlan;
  name: string;
  price: string;
  amountHalalas: number;
  features: string[];
  modules: PlanModule[];
  employeeSeats: number;
};

export function planCards(): PlanCard[] {
  return (Object.keys(BILLING_PLANS) as BillingPlan[]).map((id) => {
    const plan = BILLING_PLANS[id];
    return {
      id,
      name: plan.name,
      price: formatHalalas(plan.amountHalalas),
      amountHalalas: plan.amountHalalas,
      features: plan.features,
      modules: planModules(id),
      employeeSeats: employeeLimitForPlan(id)
    };
  });
}

/** Whether a persona agent (social, voice, seo, sales, support, analyst) can run on `plan`. */
export function personaAvailableOnPlan(role: string, plan: MerchantPlan): boolean {
  return isAgentRole(role) && planIncludesFeature(plan, AGENT_FEATURE[role]);
}
