/**
 * F24 Twilio voice inbound + F05 voice bridge: both fail closed, verify before any DB work.
 * (Call-time gate matrix: inbound-gate.test.ts; bridge session / tool gate: bridge.test.ts.)
 */
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaimDb, rawPost, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({ db: null as unknown as ClaimDb }));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.db.client,
  getServerSupabase: async () => {
    throw new Error("webhooks must not use the user session client");
  }
}));
vi.mock("@/lib/voice/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/agent")>();
  return { ...actual, dispatchVoiceTool: vi.fn(async () => ({ output: "حالة الطلب: تم الشحن.", outcome: "ok" })) };
});
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { POST as voiceInbound } from "@/app/api/voice/twilio/inbound/route";
import { POST as voiceBridge } from "@/app/api/voice/webhook/route";
import { dispatchVoiceTool } from "@/lib/voice/agent";

const MERCHANT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "platform-twilio-auth-token";
const SITE = "https://arabclue.test";
const PATH = "/api/voice/twilio/inbound";
const BRIDGE_SECRET = "bridge-secret-0123456789";

function twilioSig(url: string, params: Record<string, string>, token = TOKEN) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}
const callParams = (sid = "CA1") => ({ CallSid: sid, Called: "+966112345678", To: "+966112345678", From: "+966500000001" });
const inbound = (params: Record<string, string>, sig: string | null) =>
  rawPost(`http://127.0.0.1:3000${PATH}`, new URLSearchParams(params).toString(), {
    "content-type": "application/x-www-form-urlencoded",
    ...(sig ? { "x-twilio-signature": sig } : {})
  });

function useDb(config: { merchant_id: string; enabled: boolean } | null = { merchant_id: MERCHANT, enabled: true }) {
  h.db = createClaimDb((call) => {
    if (call.table === "voice_configs" && call.op === "select") return { data: config };
    if (call.table === "merchants" && call.op === "select") {
      return { data: { id: MERCHANT, seller_name: "متجر", plan: "plus", subscription_status: "active" } };
    }
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
});
afterEach(() => {
  for (const k of ["NEXT_PUBLIC_SITE_URL", "TWILIO_AUTH_TOKEN", "VOICE_BRIDGE_WS_URL", "VOICE_BRIDGE_SECRET"]) delete process.env[k];
});

describe("POST /api/voice/twilio/inbound (F24)", () => {
  beforeEach(() => {
    process.env.VOICE_BRIDGE_SECRET = BRIDGE_SECRET;
  });

  it("a signed call gets the bridge TwiML, one masked voice.inbound_call event and a call-log row", async () => {
    const params = callParams();
    const res = await voiceInbound(inbound(params, twilioSig(`${SITE}${PATH}`, params)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const xml = await res.text();
    expect(xml).toContain('<Stream url="wss://bridge.arabclue.test/stream">');
    expect(xml).toContain(`<Parameter name="merchantId" value="${MERCHANT}"/>`);
    const events = h.db.appWrites().filter((c) => c.table === "events");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ kind: "voice.inbound_call", merchant: MERCHANT });
    // SW-45: the platform log keeps a masked caller, never the number itself
    expect(JSON.stringify(events[0].payload)).not.toContain("500000001");
    expect((events[0].payload as { payload: Record<string, unknown> }).payload).toMatchObject({ caller: "•••• 0001", outcome: "bridged" });
    const log = h.db.appWrites().filter((c) => c.table === "voice_calls");
    expect(log).toHaveLength(1);
    expect(log[0].payload).toMatchObject({ merchant_id: MERCHANT, call_sid: "CA1", caller_number: "+966500000001", outcome: "bridged" });
  });

  it("a Twilio retry of the same CallSid gets the same TwiML but no second event", async () => {
    const params = callParams("CA-retry");
    const sig = twilioSig(`${SITE}${PATH}`, params);
    await voiceInbound(inbound(params, sig));
    const again = await voiceInbound(inbound(params, sig));
    expect(await again.text()).toContain("<Connect>");
    expect(h.db.appWrites().filter((c) => c.table === "events")).toHaveLength(1);
  });

  it.each([
    ["missing", null],
    ["forged", "Zm9yZ2Vk"],
    ["signed with another token", twilioSig(`${SITE}${PATH}`, callParams(), "other-token")]
  ])("%s signature → 403 TwiML, no DB access at all", async (_l, sig) => {
    const res = await voiceInbound(inbound(callParams(), sig));
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/^<\?xml[^>]*><Response>/);
    expect(h.db.calls).toEqual([]);
    expect(h.db.rpcCalls).toEqual([]);
  });

  it("503 TwiML when TWILIO_AUTH_TOKEN is unset (fail closed)", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const params = callParams();
    const res = await voiceInbound(inbound(params, twilioSig(`${SITE}${PATH}`, params)));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("<Hangup/>");
    expect(h.db.calls).toEqual([]);
  });

  it("an unknown number gets the 'unavailable' TwiML and no record at all", async () => {
    useDb(null);
    const params = callParams("CA2");
    const res = await voiceInbound(inbound(params, twilioSig(`${SITE}${PATH}`, params)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("غير متاح");
    expect(h.db.appWrites()).toEqual([]);
  });

  it("a DB failure still answers valid TwiML (Arabic apology)", async () => {
    h.db = createClaimDb((call) => (call.table === "voice_configs" ? { error: { message: "db down" } } : undefined));
    const params = callParams("CA3");
    const res = await voiceInbound(inbound(params, twilioSig(`${SITE}${PATH}`, params)));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Hangup/>");
  });

  it("413 TwiML for an oversized form", async () => {
    const res = await voiceInbound(inbound({ Called: "x".repeat(70_000) }, "sig"));
    expect(res.status).toBe(413);
  });
});

describe("POST /api/voice/webhook — bridge tool calls (F05)", () => {
  const call = { name: "lookup_order", arguments: { orderNumber: "1001" } };
  const bridge = (body: unknown, auth?: string) =>
    rawPost("https://arabclue.test/api/voice/webhook", typeof body === "string" ? body : JSON.stringify(body), {
      "content-type": "application/json",
      ...(auth ? { authorization: auth } : {})
    });

  it("503 when VOICE_BRIDGE_SECRET is unset — 'Bearer undefined' no longer passes", async () => {
    const res = await voiceBridge(bridge({ merchantId: MERCHANT, call }, "Bearer undefined"));
    expect(res.status).toBe(503);
    expect(h.db.calls).toEqual([]);
    expect(dispatchVoiceTool).not.toHaveBeenCalled();
  });

  it("401 for a wrong or missing bearer token", async () => {
    process.env.VOICE_BRIDGE_SECRET = BRIDGE_SECRET;
    expect((await voiceBridge(bridge({ merchantId: MERCHANT, call }, "Bearer wrong"))).status).toBe(401);
    expect((await voiceBridge(bridge({ merchantId: MERCHANT, call }))).status).toBe(401);
    expect(h.db.calls).toEqual([]);
  });

  it("validates the body: merchantId must be a uuid, call a known tool with bounded arguments", async () => {
    process.env.VOICE_BRIDGE_SECRET = BRIDGE_SECRET;
    const auth = `Bearer ${BRIDGE_SECRET}`;
    expect((await voiceBridge(bridge({ merchantId: "../../x", call }, auth))).status).toBe(400);
    expect((await voiceBridge(bridge({ merchantId: MERCHANT, call: { name: "drop_tables", arguments: {} } }, auth))).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
    expect((await voiceBridge(bridge({ merchantId: MERCHANT, call: { name: "lookup_order", arguments: many } }, auth))).status).toBe(400);
    expect((await voiceBridge(bridge({ merchantId: MERCHANT, callSid: "not-a-sid", call }, auth))).status).toBe(400);
    expect((await voiceBridge(bridge("{not json", auth))).status).toBe(400);
    expect(dispatchVoiceTool).not.toHaveBeenCalled();
  });

  it("413 for an oversized body (after auth, before parsing)", async () => {
    process.env.VOICE_BRIDGE_SECRET = BRIDGE_SECRET;
    const res = await voiceBridge(bridge(`{"pad":"${"x".repeat(70_000)}"}`, `Bearer ${BRIDGE_SECRET}`));
    expect(res.status).toBe(413);
    expect(dispatchVoiceTool).not.toHaveBeenCalled();
  });

  it("dispatches an authorised tool call for that merchant (no stored token passed around)", async () => {
    process.env.VOICE_BRIDGE_SECRET = BRIDGE_SECRET;
    const res = await voiceBridge(bridge({ merchantId: MERCHANT, call }, `Bearer ${BRIDGE_SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ output: "حالة الطلب: تم الشحن." });
    expect(vi.mocked(dispatchVoiceTool).mock.calls[0][0]).toEqual(call);
    const ctx = vi.mocked(dispatchVoiceTool).mock.calls[0][1];
    expect(ctx).toMatchObject({ merchantId: MERCHANT, callerNumber: null });
    expect(ctx).not.toHaveProperty("accessToken");
  });
});
