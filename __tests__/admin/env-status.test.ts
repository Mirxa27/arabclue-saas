import { describe, expect, it } from "vitest";
import { configHealthSummary, getPlatformConfigGroups } from "@/lib/admin/env-status";

describe("admin env status", () => {
  it("lists config groups with vars", () => {
    const groups = getPlatformConfigGroups();
    expect(groups.length).toBeGreaterThan(5);
    expect(groups.some((g) => g.id === "ai")).toBe(true);
  });

  it("summarizes health", () => {
    const groups = getPlatformConfigGroups();
    const health = configHealthSummary(groups);
    expect(health.total).toBeGreaterThan(0);
    expect(typeof health.ready).toBe("boolean");
  });
});
