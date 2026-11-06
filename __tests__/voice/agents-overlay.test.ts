/**
 * SW-21: the overview persona card for سالم and the voice page drive ONE flag — the
 * voice_configs.enabled the call path reads — and the card shows what the next call does.
 *  - PATCH /api/agents/status {role: voice, enabled:false} writes voice_configs.enabled=false, and
 *    the next inbound call then hears "unavailable";
 *  - switching on applies the same gates as the voice page (plan, kill switch, media bridge);
 *  - GET shows voice active only with a number; "configuring" while one is missing.
 */
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import { createClaimDb, rawPost } from "../helpers/webhook-fakes";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant,
  /** the one voice_configs row both the API and the call path see */
  voice: { merchant_id: "", enabled: false, phone_number: null as string | null, dialect: null, hours: null, escalation_phone: null, knowledge: null, provisioning_started_at: null, updated_at: null },
  agents: { voice: { enabled: true, defaultDialect: "khaliji" } }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => h.user.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireMerchantApi: vi.fn(async () => h.merchant) };
});
vi.mock("@/lib/admin/platform-settings", () => ({ getAgentSettings: vi.fn(async () => h.agents) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { GET, PATCH } from "@/app/api/agents/status/route";
import { POST as voiceInbound } from "@/app/api/voice/twilio/inbound/route";

const MERCHANT_ID = "00000000-0000-4000-8000-00000000aaa2";

const merchant = (plan: Merchant["plan"] = "plus"): Merchant => ({
  id: MERCHANT_ID,
  salla_merchant_id: null,
  store_url: null,
  seller_name: "Store",
  vat_number: null,
  cr_number: null,
  seller_address: null,
  token_expires_at: null,
  plan,
  subscription_status: "active",
  owner_user_id: "u1",
  zatca_onboarded_at: null,
  installed_at: null,
  uninstalled_at: null
});

/** A tiny shared store: upserts to voice_configs change h.voice; reads return it. */
function handler(label: string) {
  return (c: FakeCall) => {
    if (c.table === "voice_configs" && c.op === "upsert") {
      Object.assign(h.voice, c.payload as object);
      return { data: { ...h.voice } };
    }
    if (c.table === "voice_configs" && c.op === "select") return { data: { ...h.voice } };
    if (c.table === "merchants" && c.op === "select") return { data: { plan: h.merchant.plan, subscription_status: h.merchant.subscription_status } };
    if (c.table === "agent_settings" && c.op === "select") return { data: label === "user" ? [] : null };
    return undefined;
  };
}

const patch = (body: unknown) => PATCH(jsonRequest("http://localhost/api/agents/status", body, { method: "PATCH" }));
const voiceEntry = async () =>
  ((await (await GET()).json()) as { agents: Array<{ role: string; enabled: boolean; status: string; lastError: string | null }> }).agents.find(
    (a) => a.role === "voice"
  )!;

beforeEach(() => {
  h.merchant = merchant();
  h.agents = { voice: { enabled: true, defaultDialect: "khaliji" } };
  Object.assign(h.voice, { merchant_id: MERCHANT_ID, enabled: false, phone_number: null });
  h.service = createFakeSupabase("service", handler("service"));
  h.user = createFakeSupabase("user", handler("user"));
  process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
  process.env.VOICE_BRIDGE_SECRET = "bridge-secret-0123456789";
});
afterEach(() => {
  for (const k of ["VOICE_BRIDGE_WS_URL", "VOICE_BRIDGE_SECRET", "TWILIO_AUTH_TOKEN"]) delete process.env[k];
});

describe("voice persona card = the phone line (SW-21)", () => {
  it("تشغيل without a number: enabled, but 'configuring' — not 'active'", async () => {
    const res = await patch({ role: "voice", enabled: true, status: "active" });
    expect(res.status).toBe(200);
    expect(h.voice.enabled).toBe(true);
    expect(((await res.json()) as { agent: { status: string } }).agent.status).toBe("configuring");
    expect(await voiceEntry()).toMatchObject({ enabled: true, status: "configuring" });
    // agent_settings no longer carries a second, unread on/off for voice
    expect(h.service.writes().filter((w) => w.table === "agent_settings")).toHaveLength(0);
  });

  it("with a provisioned number the card shows active (a number bought via provision-number shows up)", async () => {
    Object.assign(h.voice, { enabled: true, phone_number: "+966112345678" });
    expect(await voiceEntry()).toMatchObject({ enabled: true, status: "active", lastError: null });
  });

  it("إيقاف sets voice_configs.enabled=false and the next call hears 'unavailable'", async () => {
    Object.assign(h.voice, { enabled: true, phone_number: "+966112345678" });
    expect((await patch({ role: "voice", enabled: false, status: "idle" })).status).toBe(200);
    expect(h.voice.enabled).toBe(false);
    expect(h.service.writes().find((w) => w.table === "voice_configs")!.payload).toMatchObject({ merchant_id: MERCHANT_ID, enabled: false });
    expect(await voiceEntry()).toMatchObject({ enabled: false, status: "idle" });

    // the call path reads the same row
    process.env.TWILIO_AUTH_TOKEN = "tok";
    const params = { CallSid: "CA00000000000000000000000000000077", Called: "+966112345678", From: "+966501112222" };
    const url = "https://arabclue.test/api/voice/twilio/inbound";
    const sig = createHmac("sha1", "tok")
      .update(Object.keys(params).sort().reduce((a, k) => a + k + params[k as keyof typeof params], url))
      .digest("base64");
    const claimDb = createClaimDb(handler("service"));
    h.service = claimDb as unknown as FakeSupabase;
    const xml = await (
      await voiceInbound(rawPost(url, new URLSearchParams(params).toString(), { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }))
    ).text();
    expect(xml).toContain("غير متاح");
    expect(xml).not.toContain("<Stream");
  });

  it("switching on from the card has the voice page's gates: plan (402) and media bridge (503)", async () => {
    h.merchant = merchant("lite");
    expect((await patch({ role: "voice", enabled: true })).status).toBe(402);
    h.merchant = merchant("plus");
    delete process.env.VOICE_BRIDGE_SECRET;
    const res = await patch({ role: "voice", enabled: true });
    expect(res.status).toBe(503);
    // the card shows the API message as is: Arabic first, then English
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/^خدمة ربط المكالمات/);
    expect(error).toContain("call bridge");
    expect(h.voice.enabled).toBe(false);
  });

  it("an enabled line whose plan lapsed shows 'paused' with the reason, and can still be switched off", async () => {
    Object.assign(h.voice, { enabled: true, phone_number: "+966112345678" });
    h.merchant = merchant("lite");
    const entry = await voiceEntry();
    expect(entry).toMatchObject({ enabled: true, status: "paused" });
    expect(entry.lastError).toMatch(/باقت/);
    expect((await patch({ role: "voice", enabled: false })).status).toBe(200);
    expect(h.voice.enabled).toBe(false);
  });

  it("other personas keep their agent_settings behaviour", async () => {
    h.service = createFakeSupabase("service", (c) => (c.op === "upsert" ? { data: { persona_role: "social", enabled: true, status: "active", last_error: null, overrides: {}, updated_at: null } } : undefined));
    expect((await patch({ role: "social", enabled: true, status: "active" })).status).toBe(200);
    expect(h.service.writes()[0]).toMatchObject({ table: "agent_settings" });
  });
});
