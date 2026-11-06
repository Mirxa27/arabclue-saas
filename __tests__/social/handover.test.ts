import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMetaWebhook } from "@/lib/meta/oauth";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ socialEnabled: true }));

// Hoisted by vitest; declared at top level so its execution order is explicit (vitest 4).
vi.mock("@/lib/social/agent", () => ({
  engager: vi.fn().mockResolvedValue({
    action: "escalate",
    reason: "Refund request",
    reply: undefined
  })
}));
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({
    social: { enabled: h.socialEnabled, cronMinutes: 15, maxPostsPerRun: 50 },
    voice: { enabled: true, defaultDialect: "khaliji" },
    seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
  }))
}));

import { engager } from "@/lib/social/agent";
import { processSocialInbound } from "@/lib/social/handover";

describe("meta webhook verify", () => {
  beforeEach(() => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
  });

  it("returns challenge when token matches", () => {
    expect(verifyMetaWebhook("subscribe", "verify-me", "12345")).toBe("12345");
  });

  it("returns null on mismatch", () => {
    expect(verifyMetaWebhook("subscribe", "wrong", "12345")).toBeNull();
  });
});

const MERCHANT_ID = "550e8400-e29b-41d4-a716-446655440000";
const message = { merchantId: MERCHANT_ID, platform: "instagram" as const, kind: "comment" as const, from: "@user", text: "I want a refund" };

function db(state: { merchant: { plan: string; subscription_status: string } | null; agent: { enabled: boolean; status: string } | null }) {
  return createFakeSupabase("service", (call: FakeCall) => {
    if (call.op === "insert") return { data: { id: "evt-1" } };
    if (call.table === "merchants") return { data: state.merchant };
    if (call.table === "agent_settings") return { data: state.agent };
    if (call.table === "brand_kits") return { data: { brand_name: "Test", essence: "x", attributes: [], dialect: "khaliji" } };
    if (call.table === "voice_configs") return { data: { escalation_phone: "+966500000000" } };
    return undefined;
  });
}

const ENTITLED = { plan: "plus", subscription_status: "active" };
const ON = { enabled: true, status: "active" };

describe("processSocialInbound", () => {
  beforeEach(() => {
    h.socialEnabled = true;
    vi.mocked(engager).mockClear();
  });

  it("escalates to social.escalation event", async () => {
    const sb = db({ merchant: ENTITLED, agent: ON });
    const result = await processSocialInbound(sb.client, message);
    expect(result.decision.action).toBe("escalate");
    expect(result.eventId).toBe("evt-1");
    expect(sb.writes().filter((w) => w.table === "events").map((w) => (w.payload as { kind: string }).kind)).toEqual([
      "social.inbound",
      "social.escalation"
    ]);
  });

  // SW-11 / SW-13: the engager is an LLM call on the platform's key.
  it.each([
    ["the merchant paused the social agent", { merchant: ENTITLED, agent: { enabled: false, status: "idle" } }, "agent_paused"],
    ["the agent status is paused", { merchant: ENTITLED, agent: { enabled: true, status: "paused" } }, "agent_paused"],
    ["the agent was never switched on", { merchant: ENTITLED, agent: null }, "agent_paused"],
    ["a Lite plan", { merchant: { plan: "lite", subscription_status: "active" }, agent: ON }, "plan_required"],
    ["a lapsed subscription", { merchant: { plan: "pro", subscription_status: "canceled" }, agent: ON }, "plan_required"]
  ])("does not call the engager when %s", async (_label, state, reason) => {
    const sb = db(state);
    const result = await processSocialInbound(sb.client, message);
    expect(engager).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: reason, decision: { action: "ignore" } });
    const [event] = sb.writes();
    expect(event).toMatchObject({ table: "events", payload: { kind: "social.inbound.skipped", merchant: MERCHANT_ID } });
    expect(JSON.stringify(event.payload)).not.toContain("refund"); // no message text is stored for skipped messages
  });

  it("does not call the engager while the admin kill switch is off", async () => {
    h.socialEnabled = false;
    const result = await processSocialInbound(db({ merchant: ENTITLED, agent: ON }).client, message);
    expect(engager).not.toHaveBeenCalled();
    expect(result.skipped).toBe("platform_disabled");
  });
});
