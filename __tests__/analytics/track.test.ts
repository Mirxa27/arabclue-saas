import { describe, expect, it } from "vitest";
import { shouldTrackAnalytics } from "@/lib/analytics/track";

describe("shouldTrackAnalytics", () => {
  it("allows tracking by default", () => {
    expect(shouldTrackAnalytics({})).toBe(true);
  });

  it("respects DNT header", () => {
    expect(shouldTrackAnalytics({ dntHeader: "1" })).toBe(false);
    expect(shouldTrackAnalytics({ dntHeader: "yes" })).toBe(false);
  });

  it("respects explicit disabled flag", () => {
    expect(shouldTrackAnalytics({ disabled: true })).toBe(false);
  });
});
