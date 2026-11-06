/**
 * The media bridge's two endpoints (F22, SW-8, SW-23, SW-24, SW-40, SW-45):
 *  - POST /api/voice/bridge/session: the GA Realtime session of a call we routed, in the
 *    merchant's dialect (or the admin default), refused once the call may not be answered;
 *  - POST /api/voice/webhook: tool calls bound to that call (verified caller), refused by the same
 *    gate without running anything, honest when a save fails, logged without caller data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import { rawPost } from "../helpers/webhook-fakes";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  agents: { voice: { enabled: true, defaultDialect: "khaliji" } } as { voice: { enabled: boolean; defaultDialect: string } },
  salla: vi.fn()
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.db.client,
  getServerSupabase: async () => {
    throw new Error("the bridge must not use a user session");
  }
}));
vi.mock("@/lib/admin/platform-settings", () => ({ getAgentSettings: vi.fn(async () => h.agents) }));
vi.mock("@/lib/salla/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salla/tokens")>()),
  sallaApiForMerchant: h.salla
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { POST as bridgeSession } from "@/app/api/voice/bridge/session/route";
import { POST as bridgeTool } from "@/app/api/voice/webhook/route";

const MERCHANT = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const SID = "CA0123456789abcdef0123456789abcdef";
const SECRET = "bridge-secret-0123456789";
const CALLER = "+966551234567";

type World = {
  plan?: Merchant["plan"];
  status?: Merchant["subscription_status"];
  enabled?: boolean;
  dialect?: string | null;
  brandDialect?: string | null;
  call?: { merchant_id: string; outcome: string; created_at?: string; caller_number?: string | null } | null;
  failBookings?: boolean;
};

function world(w: World = {}) {
  const {
    plan = "plus",
    status = "active",
    enabled = true,
    dialect = null,
    brandDialect = null,
    call = { merchant_id: MERCHANT, outcome: "bridged" },
    failBookings = false
  } = w;
  h.db = createFakeSupabase("service", (c: FakeCall) => {
    if (c.table === "merchants" && c.op === "select") {
      return { data: { id: MERCHANT, plan, subscription_status: status, seller_name: "بيت العود", salla_store_name: null, owner_user_id: null } };
    }
    if (c.table === "voice_configs" && c.op === "select") {
      return {
        data: {
          merchant_id: MERCHANT,
          enabled,
          dialect,
          hours: "٩ص – ١١م",
          escalation_phone: "+966112223333",
          knowledge: "التوصيل خلال يومين",
          phone_number: "+966112345678",
          provisioning_started_at: null,
          updated_at: null
        }
      };
    }
    if (c.table === "brand_kits") return { data: brandDialect ? { dialect: brandDialect } : null };
    if (c.table === "voice_calls" && c.op === "select") {
      return { data: call ? { caller_number: CALLER, created_at: new Date().toISOString(), ...call } : null };
    }
    if (c.table === "bookings" && c.op === "insert") {
      return failBookings ? { error: { code: "23502", message: "null value in column mobile" } } : { data: { id: "b7f3c2d1-0000-4000-8000-000000000001" } };
    }
    if (c.table === "voice_escalations" && c.op === "select") return { data: null };
    if (c.table === "voice_escalations" && c.op === "insert") return { data: { id: "e1111111-0000-4000-8000-000000000001" } };
    return undefined;
  });
}

const post = (url: string, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  rawPost(url, JSON.stringify(body), { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) });
const session = (body: unknown, auth?: string | null) => bridgeSession(post("https://arabclue.test/api/voice/bridge/session", body, auth));
const tool = (body: unknown, auth?: string | null) => bridgeTool(post("https://arabclue.test/api/voice/webhook", body, auth));

const writes = () => h.db.writes();
const eventPayloads = () => writes().filter((w) => w.table === "events").map((w) => w.payload as { kind: string; payload: Record<string, unknown> });

beforeEach(() => {
  vi.clearAllMocks();
  h.agents = { voice: { enabled: true, defaultDialect: "khaliji" } };
  process.env.VOICE_BRIDGE_SECRET = SECRET;
  world();
});
afterEach(() => {
  delete process.env.VOICE_BRIDGE_SECRET;
  delete process.env.RESEND_API_KEY;
});

describe("POST /api/voice/bridge/session", () => {
  it("fails closed without the secret (503) or with a wrong one (401)", async () => {
    delete process.env.VOICE_BRIDGE_SECRET;
    expect((await session({ merchantId: MERCHANT, callSid: SID }, "Bearer undefined")).status).toBe(503);
    process.env.VOICE_BRIDGE_SECRET = SECRET;
    expect((await session({ merchantId: MERCHANT, callSid: SID }, "Bearer nope")).status).toBe(401);
    expect(h.db.calls).toHaveLength(0);
  });

  it("returns the GA session for a call routed to this merchant, in the merchant's dialect", async () => {
    world({ dialect: "msa" });
    const res = await session({ merchantId: MERCHANT, callSid: SID });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Record<string, unknown> & { instructions: string; audio: { input: { format: unknown } } }; greeting: string; dialect: string; maxCallSeconds: number };
    expect(body.session).toMatchObject({ type: "realtime", model: "gpt-realtime-2.1", output_modalities: ["audio"] });
    expect(body.session.audio.input.format).toEqual({ type: "audio/pcmu" });
    expect(body.session.instructions).toContain("بيت العود");
    expect(body.session.instructions).toContain("التوصيل خلال يومين");
    expect(body.session.instructions).toContain("بالعربية الفصحى");
    expect(body.session.instructions).not.toMatch(/أبشر|تأمر/);
    expect(body).toMatchObject({ dialect: "msa", maxCallSeconds: 480 });
    expect(body.greeting).toContain("السلام عليكم، هاتف بيت العود");
    expect(writes()).toHaveLength(0);
  });

  it("falls back to the brand kit dialect, then to the admin default (SW-40)", async () => {
    world({ dialect: null, brandDialect: "english" });
    expect(((await (await session({ merchantId: MERCHANT, callSid: SID })).json()) as { dialect: string }).dialect).toBe("english");
    world({ dialect: null, brandDialect: null });
    h.agents = { voice: { enabled: true, defaultDialect: "msa" } };
    expect(((await (await session({ merchantId: MERCHANT, callSid: SID })).json()) as { dialect: string }).dialect).toBe("msa");
  });

  it.each([
    ["no such call", { call: null }],
    ["another merchant's call", { call: { merchant_id: OTHER, outcome: "bridged" } }],
    ["a declined call", { call: { merchant_id: MERCHANT, outcome: "declined" } }],
    ["a call from yesterday", { call: { merchant_id: MERCHANT, outcome: "bridged", created_at: new Date(Date.now() - 26 * 3600_000).toISOString() } }]
  ])("404 unknown_call for %s", async (_l, w) => {
    world(w as World);
    const res = await session({ merchantId: MERCHANT, callSid: SID });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "unknown_call" });
  });

  it.each([
    ["a lite plan", { plan: "lite" as const }, "plan"],
    ["the merchant's off switch", { enabled: false }, "agent_off"]
  ])("403 voice_unavailable for %s (SW-8)", async (_l, w, reason) => {
    world(w);
    const res = await session({ merchantId: MERCHANT, callSid: SID });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "voice_unavailable", reason });
  });

  it("403 when the platform kill switch is off", async () => {
    h.agents = { voice: { enabled: false, defaultDialect: "khaliji" } };
    expect((await session({ merchantId: MERCHANT, callSid: SID })).status).toBe(403);
  });

  it("requires a call SID", async () => {
    expect((await session({ merchantId: MERCHANT })).status).toBe(400);
  });
});

describe("POST /api/voice/webhook — tool calls", () => {
  it.each([
    ["a lite plan", { plan: "lite" as const }],
    ["a pending subscription", { status: "pending" as const }],
    ["the merchant's off switch", { enabled: false }]
  ])("refuses for %s: 403 with a polite output, nothing dispatched or written (SW-8)", async (_l, w) => {
    world(w);
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "book_appointment", arguments: { name: "Sara", preferredTime: "5pm" } } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "voice_unavailable", output: "عذراً، الخدمة غير متاحة حالياً." });
    expect(writes()).toHaveLength(0);
    expect(h.salla).not.toHaveBeenCalled();
  });

  it("refuses when the platform kill switch is off", async () => {
    h.agents = { voice: { enabled: false, defaultDialect: "khaliji" } };
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "check_product", arguments: { query: "عود" } } });
    expect(res.status).toBe(403);
    expect(h.salla).not.toHaveBeenCalled();
  });

  it("404 for a call SID that was not routed to this merchant", async () => {
    world({ call: { merchant_id: OTHER, outcome: "bridged" } });
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "lookup_order", arguments: {} } });
    expect(res.status).toBe(404);
    expect(h.salla).not.toHaveBeenCalled();
  });

  it("order lookups use the call's verified caller id (SW-23)", async () => {
    h.salla.mockResolvedValue({ data: [{ id: 9, status: { name: "تم الشحن" }, customer: { mobile: 551234567, mobile_code: "+966" } }] });
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "lookup_order", arguments: {} } });
    expect(await res.json()).toEqual({ output: "حالة الطلب: تم الشحن." });
    expect(h.salla).toHaveBeenCalledWith(MERCHANT, "/orders?keyword=551234567&sort_by=created_at-desc&per_page=30");
  });

  it("without a call SID there is no verified caller: no lookup", async () => {
    const res = await tool({ merchantId: MERCHANT, call: { name: "lookup_order", arguments: { orderNumber: "1001" } } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { output: string }).output).toContain("للخصوصية");
    expect(h.salla).not.toHaveBeenCalled();
  });

  it("a failed booking insert is never announced as booked (SW-24)", async () => {
    world({ failBookings: true });
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "book_appointment", arguments: { name: "Sara", preferredTime: "5pm" } } });
    expect(res.status).toBe(200);
    const { output } = (await res.json()) as { output: string };
    expect(output).toContain("ما قدرت أسجّل الحجز");
    expect(output).not.toContain("رقم الطلب");
    expect(eventPayloads().find((e) => e.kind === "voice.tool_call")!.payload).toEqual({ name: "book_appointment", outcome: "failed", call_sid: SID });
  });

  it("a saved booking reaches the merchant: bookings row + voice.booking event (ids only) + minimised tool event", async () => {
    const res = await tool({
      merchantId: MERCHANT,
      callSid: SID,
      call: { name: "book_appointment", arguments: { name: "سارة", preferredTime: "الخميس ٥ م", note: "قص شعر" } }
    });
    expect(((await res.json()) as { output: string }).output).toContain("رقم الطلب b7f3c2d1");
    const booking = writes().find((w) => w.table === "bookings")!;
    expect(booking.payload).toMatchObject({ merchant_id: MERCHANT, name: "سارة", mobile: CALLER, source: "voice", status: "new" });
    const kinds = eventPayloads();
    expect(kinds.find((e) => e.kind === "voice.booking")!.payload).toEqual({
      booking_id: "b7f3c2d1-0000-4000-8000-000000000001",
      call_sid: SID,
      notified: "not_configured"
    });
    const toolEvent = kinds.find((e) => e.kind === "voice.tool_call")!;
    expect(toolEvent.payload).toEqual({ name: "book_appointment", outcome: "ok", call_sid: SID, booking_id: "b7f3c2d1-0000-4000-8000-000000000001" });
    // SW-45: no caller name, number or note in the platform log
    const logged = JSON.stringify(kinds);
    expect(logged).not.toContain("سارة");
    expect(logged).not.toContain("551234567");
    expect(logged).not.toContain("قص شعر");
  });

  it("an escalation is stored for the merchant with the verified callback number", async () => {
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "escalate_to_human", arguments: { reason: "شكوى", summary: "تأخر الطلب" } } });
    expect(((await res.json()) as { output: string }).output).toContain("بيتواصلون معك على رقمك");
    const row = writes().find((w) => w.table === "voice_escalations" && w.op === "insert")!;
    expect(row.payload).toMatchObject({ merchant_id: MERCHANT, call_sid: SID, reason: "شكوى", summary: "تأخر الطلب", callback_number: CALLER, status: "open" });
    const event = eventPayloads().find((e) => e.kind === "voice.escalation")!;
    expect(event.payload).toEqual({ escalation_id: "e1111111-0000-4000-8000-000000000001", call_sid: SID, notified: "not_configured" });
  });

  it("a crash inside a tool still answers with an honest line", async () => {
    h.salla.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await tool({ merchantId: MERCHANT, callSid: SID, call: { name: "check_product", arguments: { query: "عود" } } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { output: string }).output).toContain("تعذّر التحقق");
  });
});
