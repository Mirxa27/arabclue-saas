/**
 * The merchant sees what callers asked for (UI-005, SW-24):
 *  - GET /api/voice/calls (bounded 1..200), /api/voice/bookings, /api/voice/escalations read the
 *    merchant's own rows through their session; PATCHes move a status only on their own rows;
 *  - a saved booking / hand-over e-mails the owner with FIXED copy (callers' words never reach a
 *    platform e-mail), capped per merchant per hour; one open hand-over per call.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant | null
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => h.user.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.merchant) throw new actual.AuthError();
      return h.merchant;
    })
  };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { GET as getCalls } from "@/app/api/voice/calls/route";
import { GET as getBookings, PATCH as patchBooking } from "@/app/api/voice/bookings/route";
import { GET as getEscalations, PATCH as patchEscalation } from "@/app/api/voice/escalations/route";
import { notifyMerchantOwner, OWNER_EMAILS_PER_HOUR, recordVoiceEscalation } from "@/lib/voice/requests";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000008a2";
const BOOKING_ID = "00000000-0000-4000-8000-0000000008b1";
const ESC_ID = "00000000-0000-4000-8000-0000000008e1";

const merchant = (): Merchant => ({
  id: MERCHANT_ID,
  salla_merchant_id: null,
  store_url: null,
  seller_name: "Store",
  vat_number: null,
  cr_number: null,
  seller_address: null,
  token_expires_at: null,
  plan: "plus",
  subscription_status: "active",
  owner_user_id: "u1",
  zatca_onboarded_at: null,
  installed_at: null,
  uninstalled_at: null
});

function clients(user: (c: FakeCall) => unknown = () => undefined, service: (c: FakeCall) => unknown = () => undefined) {
  h.user = createFakeSupabase("user", user as never);
  h.service = createFakeSupabase("service", service as never);
}

const get = (url: string) => new NextRequest(url);

beforeEach(() => {
  h.merchant = merchant();
  clients();
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  vi.unstubAllGlobals();
});

describe("GET /api/voice/calls", () => {
  it("reads the merchant's call log through their session, newest first, bounded", async () => {
    const row = { id: "c1", created_at: "2026-11-06T09:00:00Z", caller_number: "+966501112222", outcome: "bridged", decline_reason: null };
    clients((c) => (c.table === "voice_calls" ? { data: [row] } : undefined));
    const res = await getCalls(get("http://localhost/api/voice/calls?limit=80"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ calls: [row], limit: 80 });
    const q = h.user.calls[0];
    expect(q).toMatchObject({ table: "voice_calls", op: "select" });
    expect(h.user.filter(q, "merchant_id")).toBe(MERCHANT_ID);
    expect(h.service.calls).toHaveLength(0);
  });

  it.each([
    ["500", 200],
    ["0", 50],
    ["-3", 50],
    ["abc", 50],
    [null, 50]
  ])("limit=%s → %s", async (raw, expected) => {
    clients((c) => (c.table === "voice_calls" ? { data: [] } : undefined));
    const res = await getCalls(get(`http://localhost/api/voice/calls${raw === null ? "" : `?limit=${raw}`}`));
    expect(((await res.json()) as { limit: number }).limit).toBe(expected);
  });

  it("401 without a session", async () => {
    h.merchant = null;
    expect((await getCalls(get("http://localhost/api/voice/calls"))).status).toBe(401);
  });
});

describe("/api/voice/bookings", () => {
  it("lists the merchant's phone bookings and filters by status", async () => {
    clients((c) => (c.table === "bookings" ? { data: [{ id: BOOKING_ID, name: "سارة", status: "new" }] } : undefined));
    const res = await getBookings(get("http://localhost/api/voice/bookings?status=new&limit=10"));
    expect(res.status).toBe(200);
    const q = h.user.calls[0];
    expect(q.filters).toEqual(
      expect.arrayContaining([
        ["eq", "merchant_id", MERCHANT_ID],
        ["eq", "source", "voice"],
        ["eq", "status", "new"]
      ])
    );
    expect((await getBookings(get("http://localhost/api/voice/bookings?status=bogus"))).status).toBe(400);
  });

  it("PATCH moves the status of the merchant's own booking (404 otherwise)", async () => {
    clients((c) => (c.table === "bookings" && c.op === "update" ? { data: { id: BOOKING_ID, status: "confirmed" } } : undefined));
    const res = await patchBooking(jsonRequest("http://localhost/api/voice/bookings", { id: BOOKING_ID, status: "confirmed" }, { method: "PATCH" }));
    expect(res.status).toBe(200);
    const w = h.user.writes()[0];
    expect(w).toMatchObject({ table: "bookings", op: "update", payload: { status: "confirmed" } });
    expect(h.user.filter(w, "merchant_id")).toBe(MERCHANT_ID);

    clients(() => ({ data: null }));
    const missing = await patchBooking(jsonRequest("http://localhost/api/voice/bookings", { id: BOOKING_ID, status: "done" }, { method: "PATCH" }));
    expect(missing.status).toBe(404);
    expect((await patchBooking(jsonRequest("http://localhost/api/voice/bookings", { id: BOOKING_ID, status: "paid" }, { method: "PATCH" }))).status).toBe(400);
  });
});

describe("/api/voice/escalations", () => {
  it("lists through the merchant's session", async () => {
    clients((c) => (c.table === "voice_escalations" ? { data: [{ id: ESC_ID, reason: "شكوى", status: "open" }] } : undefined));
    const res = await getEscalations(get("http://localhost/api/voice/escalations?status=open"));
    expect(((await res.json()) as { escalations: unknown[] }).escalations).toHaveLength(1);
    expect(h.user.filter(h.user.calls[0], "merchant_id")).toBe(MERCHANT_ID);
  });

  it("PATCH resolves on the service role, scoped to the session's merchant", async () => {
    clients(undefined, (c) => (c.table === "voice_escalations" && c.op === "update" ? { data: { id: ESC_ID, status: "resolved" } } : undefined));
    const res = await patchEscalation(jsonRequest("http://localhost/api/voice/escalations", { id: ESC_ID, status: "resolved" }, { method: "PATCH" }));
    expect(res.status).toBe(200);
    const w = h.service.writes()[0];
    expect(w.payload).toMatchObject({ status: "resolved" });
    expect((w.payload as { resolved_at: string | null }).resolved_at).toBeTruthy();
    expect(h.service.filter(w, "merchant_id")).toBe(MERCHANT_ID);
    expect(h.user.writes()).toHaveLength(0);
  });
});

describe("owner notifications and escalation records", () => {
  function ownerDb(extra: (c: FakeCall) => unknown = () => undefined) {
    const db = createFakeSupabase("service", (c: FakeCall) => {
      if (c.table === "merchants") return { data: { owner_user_id: "owner-1" } };
      return extra(c) as never;
    });
    (db.client as unknown as { auth: unknown }).auth = {
      admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "owner@store.test" } } })) }
    };
    return db;
  }

  it("not configured → no mail, recorded as such", async () => {
    expect(await notifyMerchantOwner(ownerDb().client, MERCHANT_ID, "booking")).toBe("not_configured");
  });

  it("sends fixed bilingual copy with the dashboard link — nothing the caller said", async () => {
    process.env.RESEND_API_KEY = "re_test_key_0123456789";
    process.env.NEXT_PUBLIC_SITE_URL = "https://arabclue.test";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notifyMerchantOwner(ownerDb().client, "00000000-0000-4000-8000-0000000008f1", "escalation")).toBe("email");
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { to: string[]; subject: string; text: string };
    expect(body.to).toEqual(["owner@store.test"]);
    expect(body.subject).toContain("A caller needs a follow-up");
    expect(body.text).toContain("https://arabclue.test/voice");
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it(`caps owner e-mails at ${OWNER_EMAILS_PER_HOUR} per merchant per hour`, async () => {
    process.env.RESEND_API_KEY = "re_test_key_0123456789";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "m" }), { status: 200 })));
    const db = ownerDb().client;
    const id = "00000000-0000-4000-8000-0000000008f2";
    const outcomes: string[] = [];
    for (let i = 0; i < OWNER_EMAILS_PER_HOUR + 1; i++) outcomes.push(await notifyMerchantOwner(db, id, "booking"));
    expect(outcomes.filter((o) => o === "email")).toHaveLength(OWNER_EMAILS_PER_HOUR);
    expect(outcomes.at(-1)).toBe("rate_limited");
  });

  it("one open escalation per call: a second request in the same call updates it", async () => {
    const db = ownerDb((c) =>
      c.table === "voice_escalations" && c.op === "select" ? { data: { id: ESC_ID, callback_number: null } } : undefined
    );
    const id = await recordVoiceEscalation(db.client, {
      merchantId: MERCHANT_ID,
      callSid: "CA0123456789abcdef0123456789abcdef",
      escalation: { reason: "استرجاع", callbackNumber: "+966509998888" }
    });
    expect(id).toBe(ESC_ID);
    const writes = db.writes();
    expect(writes.filter((w) => w.op === "insert")).toHaveLength(0);
    expect(writes[0]).toMatchObject({ table: "voice_escalations", op: "update", payload: { callback_number: "+966509998888" } });
  });

  it("a failed insert is reported and returns null (the caller is told)", async () => {
    const db = ownerDb((c) => (c.table === "voice_escalations" && c.op === "insert" ? { error: { message: "down" } } : undefined));
    expect(await recordVoiceEscalation(db.client, { merchantId: MERCHANT_ID, callSid: null, escalation: { reason: "x", callbackNumber: null } })).toBeNull();
    expect(db.writes().some((w) => w.table === "events")).toBe(false);
  });
});
