import { describe, it, expect } from "vitest";
import { nextSignificantEvents, SAUDI_CALENDAR_2026 } from "@/lib/social/calendar";

describe("Saudi calendar", () => {
  it("contains the canonical national days", () => {
    const names = SAUDI_CALENDAR_2026.map((e) => e.name);
    expect(names).toContain("Founding Day");
    expect(names).toContain("National Day");
  });

  it("returns upcoming events sorted ascending from a given date", () => {
    const upcoming = nextSignificantEvents(new Date("2026-04-01"), 5);
    expect(upcoming.length).toBeGreaterThan(0);
    const dates = upcoming.map((e) => new Date(e.date).getTime());
    const sorted = [...dates].sort((a, b) => a - b);
    expect(dates).toEqual(sorted);
    expect(new Date(upcoming[0].date).getTime()).toBeGreaterThanOrEqual(new Date("2026-04-01").getTime());
  });

  it("respects the count parameter", () => {
    expect(nextSignificantEvents(new Date("2026-01-01"), 3).length).toBe(3);
  });
});
