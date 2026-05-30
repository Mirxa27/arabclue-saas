import { describe, expect, it } from "vitest";
import {
  DASHBOARD_NAV,
  MERCHANT_PROTECTED_PREFIXES,
  isDashboardNavActive,
  isMerchantProtectedPath,
  isAdminProtectedPath,
} from "@/lib/navigation/dashboard-nav";

describe("dashboard navigation", () => {
  it("covers all merchant dashboard routes", () => {
    const hrefs = new Set(DASHBOARD_NAV.map((i) => i.href));
    const expected = [
      "/dashboard",
      "/invoices",
      "/social",
      "/voice",
      "/marketplace",
      "/employees",
      "/seo",
      "/brand",
      "/integrations",
      "/billing",
      "/settings",
    ];
    for (const path of expected) {
      expect(hrefs.has(path), `missing nav item for ${path}`).toBe(true);
    }
  });

  it("marks nested routes active for their parent", () => {
    expect(isDashboardNavActive("/employees/abc", "/employees")).toBe(true);
    expect(isDashboardNavActive("/marketplace/social-manager", "/marketplace")).toBe(true);
    expect(isDashboardNavActive("/invoices/123", "/invoices")).toBe(true);
    expect(isDashboardNavActive("/dashboard", "/invoices")).toBe(false);
  });

  it("protects merchant prefixes including employees and marketplace", () => {
    expect(isMerchantProtectedPath("/employees")).toBe(true);
    expect(isMerchantProtectedPath("/employees/uuid/tasks")).toBe(true);
    expect(isMerchantProtectedPath("/marketplace")).toBe(true);
    expect(isMerchantProtectedPath("/marketplace/slug")).toBe(true);
    expect(isMerchantProtectedPath("/login")).toBe(false);
    expect(isMerchantProtectedPath("/")).toBe(false);
  });

  it("aligns middleware prefixes with nav destinations", () => {
    const navHrefs = DASHBOARD_NAV.map((i) => i.href);
    for (const href of navHrefs) {
      expect(
        isMerchantProtectedPath(href),
        `${href} should be middleware-protected`,
      ).toBe(true);
    }
    expect(MERCHANT_PROTECTED_PREFIXES).toContain("/welcome");
  });

  it("detects admin paths", () => {
    expect(isAdminProtectedPath("/admin")).toBe(true);
    expect(isAdminProtectedPath("/admin/merchants/1")).toBe(true);
    expect(isAdminProtectedPath("/dashboard")).toBe(false);
  });
});
