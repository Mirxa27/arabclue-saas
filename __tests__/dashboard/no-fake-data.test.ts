/**
 * Regression guard for the dashboard stream (F21 / UI-004 / UI-009 / UI-010 / UI-011 / UI-016 /
 * UI-017 / UI-027 / UI-028 / UI-029): the pages render from real data only. The suite has no
 * JSX transform, so this checks the sources for the specific fixtures and literals that used to
 * be shown as the merchant's own data. Behaviour is covered by the lib/route tests beside it.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("no fixtures or literals presented as merchant data", () => {
  it("SEO page: no FAUX rank/audit fixtures, no success toast on failure, no rank estimates", () => {
    const seo = src("app", "(dashboard)", "seo", "page.tsx");
    expect(seo).not.toMatch(/FAUX_|example\.salla\.sa|cached results|\/api\/seo\/ranks/);
    expect(seo).not.toMatch(/Keywords Tracked|Improvements/);
    expect(seo).toContain('"/api/seo/audit"');
    expect(seo).toContain('"/api/seo/generate"');
    expect(seo).toContain("SeoContentPreview");
    expect(seo).toMatch(/never estimate rankings/);
  });

  it("overview: no hard-coded health, fill bars, agent counts, plan features or dead rows", () => {
    const page = src("app", "(dashboard)", "dashboard", "page.tsx");
    const view = src("components", "dashboard", "overview-view.tsx");
    const dash = `${page}\n${view}`;
    expect(dash).not.toMatch(/ZATCA On|AI Agents Active|Salla Synced/);
    expect(dash).not.toMatch(/fill=\{65\}|value: 3,|5 calls\/mo|AI social planner/);
    expect(dash).not.toMatch(/cursor-pointer/);
    expect(view).toContain("href={`/invoices/${inv.id}`}");
    expect(page).toContain("loadOverview(");
    // ZATCA Phase 2: both outcomes count as accepted (cleared standard + reported simplified)
    expect(view).toContain('label="Accepted by ZATCA · 30 days"');
    expect(view).toMatch(/reported: \{ ar: "[^"]+", en: "reported", tone: "success" \}/);
    expect(dash).not.toMatch(/href="\/settings"[\s\S]{0,200}Configure/);
    // The server page must not import the shared primitives (module-scope React context → RSC crash).
    expect(page).not.toContain("@/components/ui/primitives");
    expect(view.startsWith('"use client";')).toBe(true);
  });

  it("topbar: identity from real columns and the auth user, a real notifications bell", () => {
    const topbar = src("components", "dashboard", "topbar.tsx");
    expect(topbar).not.toMatch(/email@example\.com|store_name|merchant\?\.name\b|merchant\?\.email/);
    expect(topbar).toContain("<NotificationsBell />");
    const bell = src("components", "dashboard", "notifications-bell.tsx");
    expect(bell).toContain('"/api/notifications"');
    expect(bell).toMatch(/unread > 0 &&/);
  });

  it("brand kit: Auto-Generate calls the real generator with the essence and dialect", () => {
    const brand = src("app", "(dashboard)", "brand", "page.tsx");
    expect(brand).toContain('"/api/brand-kit/generate"');
    expect(brand).toMatch(/description: essence/);
    expect(brand).toMatch(/dialect: kit\.dialect/);
  });
});
