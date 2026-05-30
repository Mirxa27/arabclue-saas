import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";

describe("oauth state", () => {
  const prev = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-oauth-state-secret-min-32-chars!!";
  });

  afterEach(() => {
    process.env.CRON_SECRET = prev;
  });

  it("round-trips signed state", () => {
    const state = createOAuthState({ merchantId: "550e8400-e29b-41d4-a716-446655440000", platform: "instagram" });
    const payload = verifyOAuthState(state);
    expect(payload.merchantId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(payload.platform).toBe("instagram");
  });

  it("rejects tampered state", () => {
    const state = createOAuthState({ merchantId: "550e8400-e29b-41d4-a716-446655440000", platform: "x" });
    const tampered = state.slice(0, -4) + "xxxx";
    expect(() => verifyOAuthState(tampered)).toThrow(/signature/i);
  });
});
