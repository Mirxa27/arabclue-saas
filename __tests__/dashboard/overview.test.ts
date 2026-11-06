/**
 * UI-010 / UI-011 / UI-027 / UI-028: the overview shows the merchant's real state — exact KPIs
 * from dashboard_overview_stats (RLS-scoped RPC), ZATCA / Salla / agents health from real
 * columns, an honest "no data" clearance rate, and a plan card from lib/billing/plans.ts.
 */
import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { clearanceOf, healthChecks, loadOverview, parseStats, planCard, EMPTY_STATS } from "@/lib/dashboard/overview";
import { BILLING_PLANS } from "@/lib/billing/plans";
import type { Merchant } from "@/lib/types/database";

const M: Merchant = {
  id: "00000000-0000-4000-8000-0000000010a2",
  salla_merchant_id: "777",
  store_url: null,
  seller_name: "Store",
  vat_number: null,
  cr_number: null,
  seller_address: null,
  token_expires_at: null,
  plan: "plus",
  subscription_status: "active",
  owner_user_id: "u1",
  zatca_onboarded_at: null,
  installed_at: null,
  uninstalled_at: null
};

describe("clearanceOf", () => {
  it("is 'no data' when nothing was submitted — never a default 100%", () => {
    expect(clearanceOf({ accepted_30d: 0, submitted_30d: 0 })).toMatchObject({ rate: null, status: "none" });
  });
  it("is accepted (cleared or reported) ÷ submitted in the same 30-day window", () => {
    expect(clearanceOf({ accepted_30d: 19, submitted_30d: 20 })).toMatchObject({ rate: 95, status: "healthy" });
    expect(clearanceOf({ accepted_30d: 15, submitted_30d: 20 })).toMatchObject({ rate: 75, status: "degraded" });
    expect(clearanceOf({ accepted_30d: 2, submitted_30d: 20 })).toMatchObject({ rate: 10, status: "critical" });
    expect(clearanceOf({ accepted_30d: 30, submitted_30d: 20 }).rate).toBe(100);
  });
});

describe("healthChecks", () => {
  const stats = { agents_enabled: 0, employees_active: 0 };
  it("a new merchant sees nothing green", () => {
    const checks = healthChecks({ merchant: { zatca_onboarded_at: null }, salla: null, stats });
    expect(checks.map((c) => [c.key, c.tone, c.href])).toEqual([
      ["zatca", "warn", "/settings"],
      ["salla", "off", "/integrations"],
      ["agents", "off", "/marketplace"]
    ]);
    for (const c of checks) expect(c.label.ar && c.label.en).toBeTruthy();
  });

  it("reflects onboarding, a live Salla connection and active agents", () => {
    const checks = healthChecks({
      merchant: { zatca_onboarded_at: "2026-10-01T00:00:00Z" },
      salla: { storeId: "777", storeName: "S", hasTokens: true, uninstalled: false, tokenInvalid: false },
      stats: { agents_enabled: 2, employees_active: 1 }
    });
    expect(checks.map((c) => c.tone)).toEqual(["ok", "ok", "ok"]);
    expect(checks[2].label.en).toBe("2 agents on · 1 employee active");
  });

  it("asks for a reconnect when Salla rejected the tokens or the app was uninstalled", () => {
    for (const salla of [
      { storeId: "777", storeName: null, hasTokens: true, uninstalled: false, tokenInvalid: true },
      { storeId: "777", storeName: null, hasTokens: false, uninstalled: true, tokenInvalid: false }
    ]) {
      expect(healthChecks({ merchant: null, salla, stats })[1]).toMatchObject({ tone: "warn", href: "/integrations" });
    }
  });
});

describe("planCard", () => {
  it("lists the plan's real, bilingual features and hides Upgrade on Pro", () => {
    const lite = planCard({ plan: "lite", subscription_status: "active" });
    expect(lite.features).toEqual(BILLING_PLANS.lite.featureList.map(({ ar, en }) => ({ ar, en })));
    expect(lite.features.map((f) => f.en).join(" ")).not.toMatch(/social|voice|calls/i);
    expect(lite.canUpgrade).toBe(true);
    expect(planCard({ plan: "pro", subscription_status: "active" }).canUpgrade).toBe(false);
    const ent = planCard({ plan: "enterprise", subscription_status: "active" });
    expect(ent.name).toBe("Enterprise");
    expect(ent.canUpgrade).toBe(false);
    expect(ent.features.map((f) => f.en)).toEqual(expect.arrayContaining(["Wathq CR intelligence", "Up to 50 AI employees"]));
  });

  it("shows the subscription status", () => {
    expect(planCard({ plan: "plus", subscription_status: "past_due" })).toMatchObject({ statusTone: "danger", statusLabel: { en: "Past due" } });
    expect(planCard({ plan: "plus", subscription_status: "pending" }).statusLabel.en).toBe("Payment pending");
    expect(planCard(null)).toMatchObject({ plan: "lite", status: "pending" });
  });
});

describe("parseStats", () => {
  it("coerces numeric strings (numeric/bigint over PostgREST) and defaults missing keys to 0", () => {
    expect(parseStats({ mtd_total: "1234.50", invoices_total: "7", month_start: "2026-10-31T21:00:00+00:00" })).toMatchObject({
      mtd_total: 1234.5,
      invoices_total: 7,
      accepted_30d: 0,
      month_start: "2026-10-31T21:00:00+00:00"
    });
    expect(parseStats(null)).toEqual(EMPTY_STATS);
  });
});

describe("loadOverview", () => {
  it("reads the stats RPC and lists through the user's session and the Salla state with the service role", async () => {
    const user = createFakeSupabase(
      "user",
      (call) => (call.table === "invoices" ? { data: [{ id: "i1", invoice_number: "INV-1", total: 10, status: "cleared", created_at: "x" }] } : { data: [] }),
      () => ({ data: { mtd_total: 170, invoices_total: 7, accepted_30d: 4, submitted_30d: 5, employees_active: 1, agents_enabled: 2 } })
    );
    const service = createFakeSupabase("service", (call) =>
      call.table === "merchants"
        ? { data: { salla_merchant_id: "777", salla_store_name: "S", access_token: "enc:v1:x", uninstalled_at: null, salla_token_invalid_at: null } }
        : undefined
    );
    const data = await loadOverview({ merchant: M, userClient: user.client, serviceClient: service.client, now: new Date("2026-11-06T12:00:00Z") });
    expect(user.rpcCalls).toEqual([{ fn: "dashboard_overview_stats", args: { p_merchant_id: M.id, p_now: "2026-11-06T12:00:00.000Z" } }]);
    expect(data.stats).toMatchObject({ mtd_total: 170, invoices_total: 7 });
    expect(data.clearance).toMatchObject({ rate: 80, status: "degraded" });
    expect(data.checks.find((c) => c.key === "salla")!.tone).toBe("ok");
    expect(data.recentInvoices).toHaveLength(1);
    expect(data.agentsHref).toBe("/employees");
    expect(JSON.stringify(data)).not.toContain("enc:v1");
    for (const call of user.calls) expect(user.filter(call, "merchant_id")).toBe(M.id);
  });

  it("without a merchant: zeros, nothing green, no service-role reads", async () => {
    const user = createFakeSupabase("user");
    const data = await loadOverview({ merchant: null, userClient: user.client, serviceClient: null });
    expect(data.stats).toEqual(EMPTY_STATS);
    expect(data.checks.every((c) => c.tone !== "ok")).toBe(true);
    expect(user.calls).toEqual([]);
    expect(data.agentsHref).toBe("/marketplace");
  });

  it("an unreadable Salla state is shown as unavailable — never as connected — without failing the page", async () => {
    const user = createFakeSupabase("user", () => ({ data: [] }), () => ({ data: {} }));
    const service = createFakeSupabase("service", () => ({ error: { message: "timeout" } }));
    const data = await loadOverview({ merchant: M, userClient: user.client, serviceClient: service.client });
    expect(data.checks.find((c) => c.key === "salla")).toMatchObject({ tone: "warn", label: { en: "Salla status unavailable" } });
  });

  it("a failed stats read is an error, not a page of zeros", async () => {
    const user = createFakeSupabase("user", () => ({ data: [] }), () => ({ error: { message: "function does not exist" } }));
    await expect(loadOverview({ merchant: M, userClient: user.client, serviceClient: null })).rejects.toMatchObject({ status: 500 });
  });
});
