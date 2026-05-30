import { describe, expect, it } from "vitest";
import { EMPLOYEE_CATALOG, getRole, getRoleBySlug, priceForTier } from "@/lib/employees/catalog";

describe("employee catalog", () => {
  it("lists at least 20 hireable roles", () => {
    expect(EMPLOYEE_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it("resolves roles by id and slug", () => {
    const first = EMPLOYEE_CATALOG[0];
    expect(getRole(first.id)?.id).toBe(first.id);
    expect(getRoleBySlug(first.slug)?.slug).toBe(first.slug);
  });

  it("prices tiers in halalas", () => {
    const role = EMPLOYEE_CATALOG[0];
    expect(priceForTier(role, "starter")).toBeGreaterThan(0);
    expect(priceForTier(role, "scale")).toBeGreaterThanOrEqual(priceForTier(role, "starter"));
  });
});
