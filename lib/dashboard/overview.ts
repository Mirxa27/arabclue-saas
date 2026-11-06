/**
 * Data for the dashboard overview (app/(dashboard)/dashboard/page.tsx) — every number and
 * status comes from the merchant's real rows (UI-010 / UI-011 / UI-028):
 *
 *   - KPIs from dashboard_overview_stats() (exact counts and sums in SQL, RLS-scoped;
 *     month-to-date = the Asia/Riyadh calendar month; rejected/failed invoices are not
 *     "invoiced"); the recent-invoice table and upcoming-post list keep their 5-row queries.
 *   - System health: ZATCA onboarding (zatca_onboarded_at), the Salla connection (service-role
 *     token state, never the tokens), enabled persona agents + active AI employees, and the
 *     30-day ZATCA acceptance rate (cleared or reported ÷ submitted; "no data" when none was).
 *   - The plan card from lib/billing/plans.ts (enterprise: its entitlement modules), with the
 *     subscription status.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoDbError } from "@/lib/db/errors";
import { BILLING_PLANS, SEO_MONTHLY_GENERATIONS, isBillingPlan } from "@/lib/billing/plans";
import { planModules } from "@/lib/billing/plan-summary";
import { PLAN_EMPLOYEE_LIMITS } from "@/lib/billing/entitlements";
import { getSallaConnectionState, type SallaConnectionState } from "@/lib/salla/connect";
import { reportError } from "@/lib/observability/error-reporter";
import type { InvoiceSummary, Merchant, MerchantPlan, SocialPostSummary } from "@/lib/types/database";

export type Bilingual = { ar: string; en: string };

export type OverviewStats = {
  month_start: string | null;
  mtd_total: number;
  mtd_count: number;
  invoices_total: number;
  invoices_30d: number;
  accepted_30d: number;
  submitted_30d: number;
  rejected_30d: number;
  posts_scheduled: number;
  posts_published_30d: number;
  posts_failed_30d: number;
  bookings_30d: number;
  agents_enabled: number;
  employees_active: number;
};

export const EMPTY_STATS: OverviewStats = {
  month_start: null,
  mtd_total: 0,
  mtd_count: 0,
  invoices_total: 0,
  invoices_30d: 0,
  accepted_30d: 0,
  submitted_30d: 0,
  rejected_30d: 0,
  posts_scheduled: 0,
  posts_published_30d: 0,
  posts_failed_30d: 0,
  bookings_30d: 0,
  agents_enabled: 0,
  employees_active: 0
};

export function parseStats(raw: unknown): OverviewStats {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof OverviewStats) => {
    const n = Number(row[k] ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    month_start: typeof row.month_start === "string" ? row.month_start : null,
    mtd_total: num("mtd_total"),
    mtd_count: num("mtd_count"),
    invoices_total: num("invoices_total"),
    invoices_30d: num("invoices_30d"),
    accepted_30d: num("accepted_30d"),
    submitted_30d: num("submitted_30d"),
    rejected_30d: num("rejected_30d"),
    posts_scheduled: num("posts_scheduled"),
    posts_published_30d: num("posts_published_30d"),
    posts_failed_30d: num("posts_failed_30d"),
    bookings_30d: num("bookings_30d"),
    agents_enabled: num("agents_enabled"),
    employees_active: num("employees_active")
  };
}

export type HealthTone = "ok" | "warn" | "off";

export type HealthCheck = { key: "zatca" | "salla" | "agents"; tone: HealthTone; label: Bilingual; href: string | null };

export type Clearance = {
  /** accepted (cleared or reported) ÷ submitted over 30 days, 0–100; null when nothing was submitted. */
  rate: number | null;
  status: "healthy" | "degraded" | "critical" | "none";
  label: Bilingual;
};

export function clearanceOf(stats: Pick<OverviewStats, "accepted_30d" | "submitted_30d">): Clearance {
  if (stats.submitted_30d <= 0) {
    return { rate: null, status: "none", label: { ar: "لا توجد بيانات بعد", en: "No data yet" } };
  }
  const rate = Math.round((Math.min(stats.accepted_30d, stats.submitted_30d) / stats.submitted_30d) * 100);
  if (rate >= 90) return { rate, status: "healthy", label: { ar: "ممتاز", en: "Excellent" } };
  if (rate >= 70) return { rate, status: "degraded", label: { ar: "جيد", en: "Good" } };
  return { rate, status: "critical", label: { ar: "يحتاج انتباهاً", en: "Needs attention" } };
}

export function healthChecks(input: {
  merchant: Pick<Merchant, "zatca_onboarded_at"> | null;
  /** "unavailable": the connection state could not be read (shown as such, never as connected). */
  salla: SallaConnectionState | null | "unavailable";
  stats: Pick<OverviewStats, "agents_enabled" | "employees_active">;
}): HealthCheck[] {
  const zatca: HealthCheck = input.merchant?.zatca_onboarded_at
    ? { key: "zatca", tone: "ok", label: { ar: "زاتكا: تم الربط", en: "ZATCA onboarded" }, href: null }
    : { key: "zatca", tone: "warn", label: { ar: "زاتكا: لم يتم الربط", en: "ZATCA not onboarded" }, href: "/settings" };

  const s = input.salla === "unavailable" ? null : input.salla;
  let salla: HealthCheck;
  if (input.salla === "unavailable") {
    salla = { key: "salla", tone: "warn", label: { ar: "سلة: تعذّر التحقق", en: "Salla status unavailable" }, href: "/integrations" };
  } else if (s?.storeId && s.hasTokens && !s.uninstalled && !s.tokenInvalid) {
    salla = { key: "salla", tone: "ok", label: { ar: "سلة: متصل", en: "Salla connected" }, href: null };
  } else if (s?.storeId && (s.tokenInvalid || !s.hasTokens || s.uninstalled)) {
    salla = { key: "salla", tone: "warn", label: { ar: "سلة: يلزم إعادة الربط", en: "Salla needs reconnecting" }, href: "/integrations" };
  } else {
    salla = { key: "salla", tone: "off", label: { ar: "سلة: غير متصل", en: "Salla not connected" }, href: "/integrations" };
  }

  const { agents_enabled: agents, employees_active: employees } = input.stats;
  const agentCheck: HealthCheck =
    agents + employees > 0
      ? {
          key: "agents",
          tone: "ok",
          label: {
            ar: `${agents} وكلاء مفعّلون · ${employees} موظفين نشطين`,
            en: `${agents} agent${agents === 1 ? "" : "s"} on · ${employees} employee${employees === 1 ? "" : "s"} active`
          },
          href: null
        }
      : { key: "agents", tone: "off", label: { ar: "لا يوجد وكلاء مفعّلون", en: "No AI agents active" }, href: "/marketplace" };

  return [zatca, salla, agentCheck];
}

export type PlanCardData = {
  plan: MerchantPlan;
  name: string;
  status: Merchant["subscription_status"] | null;
  statusLabel: Bilingual;
  statusTone: "success" | "warn" | "danger" | "default";
  features: Bilingual[];
  /** Pro and Enterprise have nothing to upgrade to. */
  canUpgrade: boolean;
};

const STATUS_LABELS: Record<NonNullable<Merchant["subscription_status"]>, { label: Bilingual; tone: PlanCardData["statusTone"] }> = {
  active: { label: { ar: "نشط", en: "Active" }, tone: "success" },
  pending: { label: { ar: "بانتظار الدفع", en: "Payment pending" }, tone: "default" },
  past_due: { label: { ar: "متأخر السداد", en: "Past due" }, tone: "danger" },
  canceled: { label: { ar: "ملغى", en: "Canceled" }, tone: "warn" }
};

export function planCard(merchant: Pick<Merchant, "plan" | "subscription_status"> | null): PlanCardData {
  const plan: MerchantPlan = merchant?.plan ?? "lite";
  const status = merchant?.subscription_status ?? "pending";
  const meta = STATUS_LABELS[status] ?? STATUS_LABELS.pending;
  let name: string;
  let features: Bilingual[];
  if (isBillingPlan(plan)) {
    name = BILLING_PLANS[plan].name;
    features = BILLING_PLANS[plan].featureList.map(({ ar, en }) => ({ ar, en }));
  } else {
    name = "Enterprise";
    features = [
      ...planModules(plan).map(({ ar, en }) => ({ ar, en })),
      { ar: `${SEO_MONTHLY_GENERATIONS[plan]} عملية توليد لمحتوى السيو شهرياً`, en: `${SEO_MONTHLY_GENERATIONS[plan]} Arabic SEO generations / month` },
      { ar: `حتى ${PLAN_EMPLOYEE_LIMITS[plan]} موظفين أذكياء`, en: `Up to ${PLAN_EMPLOYEE_LIMITS[plan]} AI employees` }
    ];
  }
  return {
    plan,
    name,
    status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    features,
    canUpgrade: plan === "lite" || plan === "plus"
  };
}

export type OverviewData = {
  stats: OverviewStats;
  recentInvoices: InvoiceSummary[];
  upcomingPosts: SocialPostSummary[];
  checks: HealthCheck[];
  clearance: Clearance;
  plan: PlanCardData;
  /** Where the agents card's "Configure" goes: hired employees, else the marketplace (UI-027). */
  agentsHref: string;
};

export async function loadOverview(args: {
  merchant: Merchant | null;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient | null;
  now?: Date;
}): Promise<OverviewData> {
  const { merchant } = args;
  if (!merchant) {
    const stats = EMPTY_STATS;
    return {
      stats,
      recentInvoices: [],
      upcomingPosts: [],
      checks: healthChecks({ merchant: null, salla: null, stats }),
      clearance: clearanceOf(stats),
      plan: planCard(null),
      agentsHref: "/marketplace"
    };
  }

  const ctx = { route: "/dashboard", merchantId: merchant.id, code: "db_read_failed" };
  const [statsRes, invoicesRes, postsRes, salla] = await Promise.all([
    args.userClient.rpc("dashboard_overview_stats", {
      p_merchant_id: merchant.id,
      p_now: (args.now ?? new Date()).toISOString()
    }),
    args.userClient
      .from("invoices")
      .select("id, invoice_number, total, status, created_at")
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .limit(5),
    args.userClient
      .from("social_posts")
      .select("id, hook, platforms, scheduled_for, status")
      .eq("merchant_id", merchant.id)
      .eq("status", "scheduled")
      .order("scheduled_for", { ascending: true })
      .limit(5),
    args.serviceClient
      ? getSallaConnectionState(args.serviceClient, merchant.id).catch((err: unknown) => {
          // A health dot is not worth failing the whole overview for; it says "unavailable".
          reportError(err, { route: "/dashboard", merchantId: merchant.id });
          return "unavailable" as const;
        })
      : Promise.resolve(null)
  ]);
  assertNoDbError(statsRes.error, "Load overview stats", ctx);
  assertNoDbError(invoicesRes.error, "Load recent invoices", ctx);
  assertNoDbError(postsRes.error, "Load upcoming posts", ctx);

  const stats = parseStats(statsRes.data);
  return {
    stats,
    recentInvoices: (invoicesRes.data ?? []) as InvoiceSummary[],
    upcomingPosts: (postsRes.data ?? []) as SocialPostSummary[],
    checks: healthChecks({ merchant, salla, stats }),
    clearance: clearanceOf(stats),
    plan: planCard(merchant),
    agentsHref: stats.employees_active > 0 ? "/employees" : "/marketplace"
  };
}
