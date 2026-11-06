/**
 * F20 / UI-018: tickets and feedback are stored (5xx when they are not — no fake 201),
 * the acknowledgement only goes to the signed-in account's own address, tickets are
 * relayed to SUPPORT_INBOX_EMAIL when configured, and both endpoints are rate-limited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as { id: string; email?: string | null } | null,
  merchant: null as { id: string; seller_name: string } | null
}));

const sendEmail = vi.hoisted(() =>
  vi.fn(async (_creds: { from: string; reply_to?: string }, _msg: { to: string; subject: string; text: string }) => ({ id: "em_1" }))
);

vi.mock("@/lib/email/platform", () => ({ sendPlatformEmail: sendEmail }));
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("support/feedback writes must use the service role");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => {
      if (!h.user) throw new actual.AuthError();
      return h.user;
    }),
    getCurrentMerchant: vi.fn(async () => h.merchant)
  };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { POST as supportPost } from "@/app/api/support/route";
import { POST as feedbackPost } from "@/app/api/feedback/route";

let seq = 0;
function freshUser(email: string | null = "owner@store.sa") {
  seq += 1;
  h.user = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, email };
  return h.user;
}

function useService(handler: FakeHandler) {
  h.service = createFakeSupabase("service", handler);
}

const ticketRow = (payload: Record<string, unknown>) => ({
  data: { id: "t-1", created_at: "2026-11-06T10:00:00Z", ...payload }
});

const support = (body: unknown) => supportPost(jsonRequest("http://localhost/api/support", body));
const feedback = (body: unknown) => feedbackPost(jsonRequest("http://localhost/api/feedback", body));

beforeEach(() => {
  sendEmail.mockClear();
  h.merchant = { id: "00000000-0000-4000-8000-0000000000a2", seller_name: "Store A" };
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.SUPPORT_INBOX_EMAIL;
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.SUPPORT_INBOX_EMAIL;
});

describe("POST /api/support", () => {
  it("requires a signed-in user", async () => {
    h.user = null;
    useService(() => undefined);
    const res = await support({ category: "help", message: "Please help me" });
    expect(res.status).toBe(401);
    expect(h.service.calls).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 (not 201) when the ticket cannot be stored, and sends nothing", async () => {
    freshUser();
    useService(() => ({ error: { code: "42P01", message: 'relation "support_tickets" does not exist' } }));
    const res = await support({ category: "bug", message: "Checkout is broken" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stores the ticket and acknowledges only the account's own email, never the body address", async () => {
    const user = freshUser("owner@store.sa");
    useService((call) => (call.op === "insert" ? ticketRow(call.payload as Record<string, unknown>) : undefined));
    const res = await support({ category: "billing", message: "Need my invoice", email: "victim@elsewhere.example" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, ticketId: "t-1", acknowledged: true, forwarded: false });
    const insert = h.service.writes()[0];
    expect(insert).toMatchObject({ table: "support_tickets", op: "insert" });
    expect(insert.payload).toMatchObject({
      user_id: user.id,
      merchant_id: "00000000-0000-4000-8000-0000000000a2",
      category: "billing",
      contact_email: "victim@elsewhere.example"
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][1].to).toBe("owner@store.sa");
  });

  it("relays the ticket to SUPPORT_INBOX_EMAIL and records it", async () => {
    freshUser("owner@store.sa");
    process.env.SUPPORT_INBOX_EMAIL = "inbox@arabclue.test";
    useService((call) => (call.op === "insert" ? ticketRow(call.payload as Record<string, unknown>) : undefined));
    const res = await support({ category: "help", message: "How do I connect Salla?" });

    expect(await res.json()).toMatchObject({ forwarded: true, acknowledged: true });
    const relay = sendEmail.mock.calls.find(([, msg]) => msg.to === "inbox@arabclue.test");
    expect(relay?.[1].text).toContain("How do I connect Salla?");
    expect(relay?.[0].reply_to).toBe("owner@store.sa");
    const marked = h.service.writes().find((w) => w.op === "update");
    expect(marked).toMatchObject({ table: "support_tickets" });
    expect(marked?.payload).toHaveProperty("forwarded_at");
  });

  it("still succeeds (reported, not faked) when email is not configured", async () => {
    freshUser();
    delete process.env.RESEND_API_KEY;
    useService((call) => (call.op === "insert" ? ticketRow(call.payload as Record<string, unknown>) : undefined));
    const res = await support({ category: "feature", message: "Add dark mode" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ acknowledged: false, forwarded: false });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rate-limits to 5 requests per 15 minutes per user", async () => {
    freshUser();
    useService((call) => (call.op === "insert" ? ticketRow(call.payload as Record<string, unknown>) : undefined));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await support({ category: "help", message: `message ${i}` })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("validates the body", async () => {
    freshUser();
    useService(() => undefined);
    expect((await support({ category: "spam", message: "hello there" })).status).toBe(400);
    expect((await support({ category: "help", message: "hi" })).status).toBe(400);
    expect((await support({ category: "help", message: "hello there", email: "not-an-email" })).status).toBe(400);
  });
});

describe("POST /api/feedback", () => {
  it("returns 500 when the feedback cannot be stored", async () => {
    freshUser();
    useService(() => ({ error: { code: "42P01", message: 'relation "user_feedback" does not exist' } }));
    const res = await feedback({ sentiment: "down", reasons: ["slow"] });
    expect(res.status).toBe(500);
  });

  it("stores feedback for the signed-in user", async () => {
    const user = freshUser();
    useService(() => undefined);
    const res = await feedback({ sentiment: "up", reasons: ["fast"], note: "Great", path: "/dashboard" });
    expect(res.status).toBe(201);
    expect(h.service.writes()[0]).toMatchObject({ table: "user_feedback", op: "insert" });
    expect(h.service.writes()[0].payload).toMatchObject({ user_id: user.id, sentiment: "up", reasons: ["fast"], note: "Great", path: "/dashboard" });
  });

  it("requires a session and bounds the payload", async () => {
    h.user = null;
    useService(() => undefined);
    expect((await feedback({ sentiment: "up" })).status).toBe(401);
    freshUser();
    expect((await feedback({ sentiment: "up", reasons: Array.from({ length: 11 }, () => "x") })).status).toBe(400);
    expect((await feedback({ sentiment: "up", path: "/".repeat(301) })).status).toBe(400);
  });
});
