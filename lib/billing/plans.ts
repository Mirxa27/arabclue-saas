import type { MerchantPlan } from "@/lib/types/database";

export type BillingPlan = Exclude<MerchantPlan, "enterprise">;

export type PlanDefinition = {
  id: BillingPlan;
  name: string;
  amountHalalas: number;
  currency: "SAR";
  description: string;
  features: string[];
};

/** Amounts in halalas (1 SAR = 100 halalas). Minimum Moyasar charge is 100 halalas. */
export const BILLING_PLANS: Record<BillingPlan, PlanDefinition> = {
  lite: {
    id: "lite",
    name: "Lite",
    amountHalalas: 9900,
    currency: "SAR",
    description: "arabclue Lite — ZATCA invoicing (monthly)",
    features: ["ZATCA invoicing", "200 invoices / month", "Arabic dashboard", "Email support"]
  },
  plus: {
    id: "plus",
    name: "Plus",
    amountHalalas: 29900,
    currency: "SAR",
    description: "arabclue Plus — invoicing + social + voice (monthly)",
    features: ["Everything in Lite", "Agentic social media", "Gulf voice agent", "Arabic SEO copy"]
  },
  pro: {
    id: "pro",
    name: "Pro",
    amountHalalas: 59900,
    currency: "SAR",
    description: "arabclue Pro — all modules + Wathq intelligence (monthly)",
    features: ["Everything in Plus", "Wathq B2B intelligence", "Priority support", "Multi-channel publishing"]
  }
};

export function getPlan(plan: BillingPlan): PlanDefinition {
  return BILLING_PLANS[plan];
}

export function formatHalalas(halalas: number): string {
  return `${(halalas / 100).toFixed(2)} SAR`;
}
