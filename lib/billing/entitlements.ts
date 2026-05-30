import type { Merchant, MerchantPlan } from "@/lib/types/database";

export type ProductFeature = "zatca" | "social" | "voice" | "seo" | "wathq" | "employees";

const PLAN_FEATURES: Record<MerchantPlan, ProductFeature[]> = {
  lite: ["zatca"],
  plus: ["zatca", "social", "voice", "seo", "employees"],
  pro: ["zatca", "social", "voice", "seo", "wathq", "employees"],
  enterprise: ["zatca", "social", "voice", "seo", "wathq", "employees"]
};

/** Max active AI employees per platform plan (add-on seats billed separately). */
export const PLAN_EMPLOYEE_LIMITS: Record<MerchantPlan, number> = {
  lite: 0,
  plus: 5,
  pro: 15,
  enterprise: 50
};

export function planIncludesFeature(plan: MerchantPlan, feature: ProductFeature): boolean {
  return PLAN_FEATURES[plan]?.includes(feature) ?? false;
}

/** Active or grace-period subscription required for paid modules (not billing/settings). */
export function merchantCanUseFeature(merchant: Merchant, feature: ProductFeature): boolean {
  if (!planIncludesFeature(merchant.plan ?? "lite", feature)) return false;
  const status = merchant.subscription_status ?? "pending";
  return status === "active" || status === "past_due";
}

export function featureGateMessage(feature: ProductFeature): string {
  const labels: Record<ProductFeature, string> = {
    zatca: "ZATCA invoicing",
    social: "Social media agent",
    voice: "Voice agent",
    seo: "Arabic SEO",
    wathq: "Wathq intelligence",
    employees: "AI employees marketplace"
  };
  return `${labels[feature]} requires an active subscription on a plan that includes this module.`;
}

export function employeeLimitForPlan(plan: MerchantPlan): number {
  return PLAN_EMPLOYEE_LIMITS[plan] ?? 0;
}

export function merchantCanHireEmployee(
  merchant: Merchant,
  currentActiveCount: number
): { allowed: boolean; reason?: string } {
  if (!merchantCanUseFeature(merchant, "employees")) {
    return { allowed: false, reason: featureGateMessage("employees") };
  }
  const limit = employeeLimitForPlan(merchant.plan ?? "lite");
  if (currentActiveCount >= limit) {
    return {
      allowed: false,
      reason: `Your ${merchant.plan} plan includes up to ${limit} AI employees. Upgrade or offboard someone to hire more.`
    };
  }
  return { allowed: true };
}
