import type { MerchantPlan } from "@/lib/types/database";
import { PLAN_EMPLOYEE_LIMITS, type ProductFeature } from "@/lib/billing/entitlements";

export type BillingPlan = Exclude<MerchantPlan, "enterprise">;

/**
 * Monthly Arabic SEO generations (POST /api/seo/generate) per plan. Enforced by the SEO
 * route through a service-role usage counter (lib/seo/usage.ts) — the merchant cannot reset
 * it by deleting generated content. Lite has no SEO module (lib/billing/entitlements.ts).
 */
export const SEO_MONTHLY_GENERATIONS: Record<MerchantPlan, number> = {
  lite: 0,
  plus: 100,
  pro: 1000,
  enterprise: 3000
};

/** Plan limits a feature line may quote; each one is enforced in code. */
export type PlanQuota = "seo_generations" | "employee_seats";

/** Non-gated promises every plan gets (support is a service, not a code path). */
export type PlanService = "email_support";

/**
 * One line of a plan card, in Arabic and English. Every line must be backed by what the
 * product enforces (critic-25, asserted by __tests__/billing/plan-features.test.ts):
 *   - module:   a ProductFeature the plan's entitlements include
 *   - includes: "everything in <lower plan>" — that plan's entitlements are a subset
 *   - quota:    a limit read from the same constant the API enforces
 *   - service:  an allow-listed, non-gated service
 */
export type PlanFeature = { ar: string; en: string } & (
  | { kind: "module"; feature: ProductFeature }
  | { kind: "includes"; plan: BillingPlan }
  | { kind: "quota"; quota: PlanQuota; limit: number }
  | { kind: "service"; service: PlanService }
);

export type PlanDefinition = {
  id: BillingPlan;
  name: string;
  amountHalalas: number;
  currency: "SAR";
  description: string;
  /** Bilingual, enforcement-backed feature lines (render `ar` / `en`). */
  featureList: PlanFeature[];
  /** English labels of `featureList`, in order (kept for existing string consumers). */
  features: string[];
};

const nf = new Intl.NumberFormat("en-US");

const moduleLine = (feature: ProductFeature, ar: string, en: string): PlanFeature => ({ kind: "module", feature, ar, en });

const seoQuota = (plan: MerchantPlan): PlanFeature => {
  const limit = SEO_MONTHLY_GENERATIONS[plan];
  return {
    kind: "quota",
    quota: "seo_generations",
    limit,
    ar: `${nf.format(limit)} عملية توليد لمحتوى السيو شهرياً`,
    en: `${nf.format(limit)} Arabic SEO generations / month`
  };
};

const seatQuota = (plan: MerchantPlan): PlanFeature => {
  const limit = PLAN_EMPLOYEE_LIMITS[plan];
  return {
    kind: "quota",
    quota: "employee_seats",
    limit,
    ar: `حتى ${nf.format(limit)} موظفين أذكياء`,
    en: `Up to ${nf.format(limit)} AI employees`
  };
};

const emailSupport: PlanFeature = {
  kind: "service",
  service: "email_support",
  ar: "دعم عبر البريد الإلكتروني",
  en: "Email support"
};

function plan(def: Omit<PlanDefinition, "features">): PlanDefinition {
  return { ...def, features: def.featureList.map((f) => f.en) };
}

/** Amounts in halalas (1 SAR = 100 halalas). Minimum Moyasar charge is 100 halalas. */
export const BILLING_PLANS: Record<BillingPlan, PlanDefinition> = {
  lite: plan({
    id: "lite",
    name: "Lite",
    amountHalalas: 9900,
    currency: "SAR",
    description: "arabclue Lite — ZATCA invoicing (monthly)",
    featureList: [moduleLine("zatca", "الفوترة الإلكترونية (زاتكا)", "ZATCA e-invoicing"), emailSupport]
  }),
  plus: plan({
    id: "plus",
    name: "Plus",
    amountHalalas: 29900,
    currency: "SAR",
    description: "arabclue Plus — invoicing + social + voice (monthly)",
    featureList: [
      { kind: "includes", plan: "lite", ar: "كل ما في لايت", en: "Everything in Lite" },
      moduleLine("social", "وكيل التواصل الاجتماعي", "Social media agent"),
      moduleLine("voice", "الوكيل الصوتي للمكالمات", "Voice call agent"),
      moduleLine("seo", "كتابة محتوى السيو بالعربية", "Arabic SEO copy"),
      seoQuota("plus"),
      moduleLine("employees", "سوق الموظفين الأذكياء", "AI employees marketplace"),
      seatQuota("plus")
    ]
  }),
  pro: plan({
    id: "pro",
    name: "Pro",
    amountHalalas: 59900,
    currency: "SAR",
    description: "arabclue Pro — all modules + Wathq intelligence (monthly)",
    featureList: [
      { kind: "includes", plan: "plus", ar: "كل ما في بلس", en: "Everything in Plus" },
      moduleLine("wathq", "بيانات السجل التجاري من واثق", "Wathq CR intelligence"),
      seoQuota("pro"),
      seatQuota("pro")
    ]
  })
};

export function getPlan(plan: BillingPlan): PlanDefinition {
  return BILLING_PLANS[plan];
}

export function isBillingPlan(value: unknown): value is BillingPlan {
  return value === "lite" || value === "plus" || value === "pro";
}

export function formatHalalas(halalas: number): string {
  return `${(halalas / 100).toFixed(2)} SAR`;
}
