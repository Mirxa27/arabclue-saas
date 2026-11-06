/**
 * RA-12 — switching a persona agent on is tied to the merchant's plan everywhere, not only in
 * PATCH /api/agents/status: updateAgentStatus (used by every social OAuth callback, the manual
 * connect route and the Salla callback) used to upsert enabled=true for any plan, so a Lite or
 * unpaid merchant who connected Instagram saw Noora as "Active" for a module they do not have.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  merchant: null as null | { plan: string; subscription_status: string }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("agent enablement must not use the user's session");
  }
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { updateAgentStatus } from "@/lib/agents/store-server";
import { persistSocialConnection } from "@/lib/oauth/flow";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000012a2";

function handler(call: FakeCall) {
  if (call.table === "merchants" && call.op === "select") return { data: h.merchant };
  return { data: null, error: null };
}

const agentUpserts = () => h.service.writes().filter((c) => c.table === "agent_settings");

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  h.service = createFakeSupabase("service", handler);
});

describe("updateAgentStatus — plan gate (RA-12)", () => {
  for (const [plan, status] of [
    ["lite", "active"],
    ["plus", "pending"],
    ["pro", "canceled"]
  ] as const) {
    it(`does not switch the social agent on for a ${plan}/${status} merchant`, async () => {
      h.merchant = { plan, subscription_status: status };
      await expect(updateAgentStatus(MERCHANT_ID, "social", true)).resolves.toBe(false);
      expect(agentUpserts()).toHaveLength(0);
      // the entitlement is read from the merchant row by id, on the service role
      const lookup = h.service.calls.find((c) => c.table === "merchants")!;
      expect(lookup.filters).toEqual([["eq", "id", MERCHANT_ID]]);
      expect(lookup.columns).toBe("plan, subscription_status");
    });
  }

  it("does nothing for an unknown merchant", async () => {
    h.merchant = null;
    await expect(updateAgentStatus(MERCHANT_ID, "voice", true)).resolves.toBe(false);
    expect(agentUpserts()).toHaveLength(0);
  });

  it("switches the agent on for an entitled merchant (plus/active, pro/past_due)", async () => {
    for (const merchant of [{ plan: "plus", subscription_status: "active" }, { plan: "pro", subscription_status: "past_due" }]) {
      h.service = createFakeSupabase("service", handler);
      h.merchant = merchant;
      await expect(updateAgentStatus(MERCHANT_ID, "social", true)).resolves.toBe(true);
      const [upsert] = agentUpserts();
      expect(upsert).toMatchObject({ op: "upsert", options: { onConflict: "merchant_id,persona_role" } });
      expect(upsert.payload).toMatchObject({ merchant_id: MERCHANT_ID, persona_role: "social", enabled: true, status: "active" });
    }
  });

  it("always lets a flow switch an agent off, without a plan lookup", async () => {
    h.merchant = { plan: "lite", subscription_status: "canceled" };
    await expect(updateAgentStatus(MERCHANT_ID, "social", false)).resolves.toBe(false);
    expect(h.service.calls.some((c) => c.table === "merchants")).toBe(false);
    expect(agentUpserts()[0].payload).toMatchObject({ enabled: false, status: "idle" });
  });
});

describe("social OAuth persistence (lib/oauth/flow.ts persistSocialConnection)", () => {
  it("a Lite merchant's Instagram connect stores the channel but leaves the agent off", async () => {
    h.merchant = { plan: "lite", subscription_status: "active" };
    await persistSocialConnection({
      merchantId: MERCHANT_ID,
      platform: "instagram",
      tokens: { accessToken: "ig-token" },
      resolveExternalId: async () => "ig-account-1"
    });
    const channel = h.service.writes().find((c) => c.table === "social_channels");
    expect(channel?.payload).toMatchObject({ merchant_id: MERCHANT_ID, platform: "instagram", external_id: "ig-account-1" });
    expect(agentUpserts().filter((c) => (c.payload as { enabled?: boolean }).enabled === true)).toHaveLength(0);
  });

  it("a paying Plus merchant's connect switches the social agent on", async () => {
    h.merchant = { plan: "plus", subscription_status: "active" };
    await persistSocialConnection({
      merchantId: MERCHANT_ID,
      platform: "instagram",
      tokens: { accessToken: "ig-token" },
      resolveExternalId: async () => "ig-account-1"
    });
    expect(agentUpserts()[0].payload).toMatchObject({ persona_role: "social", enabled: true, status: "active" });
  });
});
