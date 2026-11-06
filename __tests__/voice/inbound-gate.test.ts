/**
 * SW-8 / SW-21 / SW-42: every inbound call re-checks, before anything is streamed or logged,
 * the platform kill switch, the plan + subscription and the merchant's own switch; and without
 * a media bridge the caller is never told they will be answered.
 */
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaimDb, rawPost, type ClaimDb } from "../helpers/webhook-fakes";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  db: null as unknown as ClaimDb,
  agents: { voice: { enabled: true, defaultDialect: "khaliji" } } as { voice: { enabled: boolean; defaultDialect: string } }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.db.client,
  getServerSupabase: async () => {
    throw new Error("webhooks must not use the user session client");
  }
}));
vi.mock("@/lib/admin/platform-settings", () => ({ getAgentSettings: vi.fn(async () => h.agents) }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { POST as voiceInbound } from "@/app/api/voice/twilio/inbound/route";
import { reportError } from "@/lib/observability/error-reporter";
import { voiceCallAllowed, voiceCallDecision } from "@/lib/voice/entitlement";

const MERCHANT = "44444444-4444-4444-8444-444444444444";
const TOKEN = "platform-twilio-auth-token";
const SITE = "https://arabclue.test";
const PATH = "/api/voice/twilio/inbound";

function signed(params: Record<string, string>) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], `${SITE}${PATH}`);
  const sig = createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
  return rawPost(`${SITE}${PATH}`, new URLSearchParams(params).toString(), {
    "content-type": "application/x-www-form-urlencoded",
    "x-twilio-signature": sig
  });
}

let sidCounter = 0;
const call = () => ({ CallSid: `CA${String(++sidCounter).padStart(32, "0")}`, Called: "+966112345678", From: "+966501112222" });

type Setup = {
  plan?: Merchant["plan"];
  status?: Merchant["subscription_status"];
  enabled?: boolean;
  escalationPhone?: string | null;
};

function setup({ plan = "plus", status = "active", enabled = true, escalationPhone = null }: Setup = {}) {
  h.db = createClaimDb((c) => {
    if (c.table === "voice_configs" && c.op === "select") {
      return { data: { merchant_id: MERCHANT, enabled, escalation_phone: escalationPhone } };
    }
    if (c.table === "merchants" && c.op === "select") return { data: { plan, subscription_status: status } };
    return undefined;
  });
}

const events = () => h.db.appWrites().filter((c) => c.table === "events");
const callLog = () => h.db.appWrites().filter((c) => c.table === "voice_calls");

beforeEach(() => {
  vi.clearAllMocks();
  h.agents = { voice: { enabled: true, defaultDialect: "khaliji" } };
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
  process.env.VOICE_BRIDGE_SECRET = "bridge-secret-0123456789";
});
afterEach(() => {
  for (const k of ["TWILIO_AUTH_TOKEN", "NEXT_PUBLIC_SITE_URL", "VOICE_BRIDGE_WS_URL", "VOICE_BRIDGE_SECRET"]) delete process.env[k];
});

describe("inbound call gate (SW-8)", () => {
  it.each([
    ["a lite merchant (plan without voice)", { plan: "lite" as const }, "plan"],
    ["an unpaid (pending) subscription", { status: "pending" as const }, "plan"],
    ["a canceled subscription", { status: "canceled" as const }, "plan"],
    ["the merchant switched the agent off (إيقاف)", { enabled: false }, "agent_off"]
  ])("%s → 'unavailable' TwiML, no stream, no event", async (_label, over, reason) => {
    setup(over);
    const res = await voiceInbound(signed(call()));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("عذراً، هذا الرقم غير متاح حالياً.");
    expect(xml).not.toContain("<Connect>");
    expect(xml).not.toContain(MERCHANT);
    expect(events()).toHaveLength(0);
    expect(h.db.rpcCalls).toHaveLength(0);
    // the merchant's own call log still shows the call it missed, and why
    expect(callLog()[0].payload).toMatchObject({ outcome: "declined", decline_reason: reason });
  });

  it("the platform kill switch (agents.voice.enabled=false) declines every call", async () => {
    setup();
    h.agents = { voice: { enabled: false, defaultDialect: "khaliji" } };
    const xml = await (await voiceInbound(signed(call()))).text();
    expect(xml).toContain("غير متاح");
    expect(xml).not.toContain("<Stream");
    expect(events()).toHaveLength(0);
    expect(callLog()[0].payload).toMatchObject({ outcome: "declined", decline_reason: "platform_off" });
  });

  it.each([["plus"], ["pro"], ["enterprise"]] as const)("%s / active with the switches on → bridged", async (plan) => {
    setup({ plan });
    const xml = await (await voiceInbound(signed(call()))).text();
    expect(xml).toContain('<Connect><Stream url="wss://bridge.arabclue.test/stream">');
    expect(events()).toHaveLength(1);
    expect(callLog()[0].payload).toMatchObject({ outcome: "bridged", caller_number: "+966501112222" });
  });

  it("past_due (grace period) still answers", async () => {
    setup({ status: "past_due" });
    expect(await (await voiceInbound(signed(call()))).text()).toContain("<Connect>");
  });

  it("the predicate itself: kill switch, plan, own switch", () => {
    const plus = { plan: "plus" as const, subscription_status: "active" as const };
    expect(voiceCallAllowed(plus, { enabled: true }, { voice: { enabled: true } })).toBe(true);
    expect(voiceCallAllowed(plus, { enabled: true }, { voice: { enabled: false } })).toBe(false);
    expect(voiceCallAllowed({ plan: "lite", subscription_status: "active" }, { enabled: true }, { voice: { enabled: true } })).toBe(false);
    expect(voiceCallAllowed(plus, { enabled: false }, { voice: { enabled: true } })).toBe(false);
    expect(voiceCallAllowed(plus, null, { voice: { enabled: true } })).toBe(false);
    expect(voiceCallDecision({ merchant: null, agentEnabled: true, platformEnabled: true })).toEqual({ allowed: false, reason: "plan" });
  });
});

describe("no media bridge (SW-42)", () => {
  beforeEach(() => {
    delete process.env.VOICE_BRIDGE_WS_URL;
  });

  it("forwards the caller to the store's escalation phone — never 'you'll be answered shortly'", async () => {
    setup({ escalationPhone: "+966551110000" });
    const xml = await (await voiceInbound(signed(call()))).text();
    expect(xml).toContain('<Dial timeout="25">+966551110000</Dial>');
    expect(xml).not.toContain("سيتم الرد عليك قريباً");
    expect(xml).not.toContain("<Stream");
    expect(callLog()[0].payload).toMatchObject({ outcome: "forwarded" });
    expect((events()[0].payload as { payload: Record<string, unknown> }).payload).toMatchObject({ outcome: "forwarded" });
    expect(vi.mocked(reportError).mock.calls.some(([e]) => String((e as Error).message).includes("media bridge not configured"))).toBe(true);
  });

  it("without an escalation phone the caller hears that the service is unavailable", async () => {
    setup();
    const xml = await (await voiceInbound(signed(call()))).text();
    expect(xml).toContain("الخدمة غير متاحة حالياً");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("سيتم الرد عليك قريباً");
    expect(callLog()[0].payload).toMatchObject({ outcome: "not_bridged" });
  });

  it("a stream URL without the bridge secret is no bridge either", async () => {
    process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
    delete process.env.VOICE_BRIDGE_SECRET;
    setup();
    expect(await (await voiceInbound(signed(call()))).text()).not.toContain("<Stream");
  });
});
