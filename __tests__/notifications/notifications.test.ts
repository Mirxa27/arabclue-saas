/**
 * UI-016: the topbar bell shows the merchant's real, actionable items — escalations (events,
 * service role, filtered to the merchant), failed posts, ZATCA rejections, new voice bookings,
 * billing problems — newest first, with unread state from the read cursor. No permanent dot:
 * nothing unread → unread_count 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  merchant: null as Merchant | null,
  signedIn: true,
  userHandler: (() => undefined) as (call: FakeCall) => FakeResult | undefined,
  serviceHandler: (() => undefined) as (call: FakeCall) => FakeResult | undefined,
  rpcResult: { data: "2026-11-06T08:00:00+00:00" } as FakeResult
}));

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  const { HttpError } = await import("@/lib/api/errors");
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.signedIn) throw new actual.AuthError();
      if (!h.merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
      return h.merchant;
    })
  };
});

import { buildFeed, loadNotifications } from "@/lib/notifications/feed";
import { GET as getFeed } from "@/app/api/notifications/route";
import { POST as markRead } from "@/app/api/notifications/read/route";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000016a2";
const EMPLOYEE_ID = "00000000-0000-4000-8000-0000000016e1";
const NOW = new Date("2026-11-06T09:00:00Z");

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
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
    uninstalled_at: null,
    ...overrides
  };
}

function sources(lastSeen: string | null) {
  h.user = createFakeSupabase("user", (call) => {
    const forced = h.userHandler(call);
    if (forced) return forced;
    switch (call.table) {
      case "merchant_notification_state":
        return { data: lastSeen ? { last_seen_at: lastSeen } : null };
      case "social_posts":
        return { data: [{ id: "post-1", hook: "عرض نهاية الأسبوع", scheduled_for: "2026-11-05T10:00:00Z" }] };
      case "invoices":
        return { data: [{ id: "inv-1", invoice_number: "INV-0042", status: "rejected", created_at: "2026-11-04T10:00:00Z" }] };
      case "bookings":
        return { data: [{ id: "bk-1", name: "سارة", preferred_time: "الأحد ٥م", created_at: "2026-11-06T07:00:00Z" }] };
      case "billing_payments":
        return { data: [{ id: "pay-1", plan: "pro", updated_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T09:00:00Z" }] };
      case "ai_employees":
        return { data: [{ id: EMPLOYEE_ID, display_name: "ليلى", updated_at: "2026-11-01T10:00:00Z" }] };
      default:
        return undefined;
    }
  });
  h.service = createFakeSupabase("service", (call) => {
    const forced = h.serviceHandler(call);
    if (forced) return forced;
    if (call.table === "events") {
      return {
        data: [
          { id: 91, kind: "social.escalation", payload: { reason: "طلب استرجاع", summary: "x" }, created_at: "2026-11-06T08:30:00Z" },
          { id: 92, kind: "voice.escalation", payload: { summary: "يريد التحدث لمسؤول" }, created_at: "2026-11-03T08:30:00Z" },
          { id: 93, kind: "employee.escalation", payload: { employee_id: EMPLOYEE_ID, reason: "x".repeat(500) }, created_at: "2026-11-02T08:30:00Z" },
          { id: 94, kind: "employee.escalation", payload: { employee_id: "../../admin", reason: "r" }, created_at: "2026-11-01T08:30:00Z" }
        ]
      };
    }
    return undefined;
  }, (fn) => (fn === "mark_notifications_seen" ? h.rpcResult : undefined));
}

beforeEach(() => {
  h.signedIn = true;
  h.merchant = merchant();
  h.userHandler = () => undefined;
  h.serviceHandler = () => undefined;
  h.rpcResult = { data: "2026-11-06T08:00:00+00:00" };
  sources(null);
});

describe("loadNotifications", () => {
  it("merges every source newest first with in-app links", async () => {
    const feed = await loadNotifications({ merchant: merchant(), userClient: h.user.client, serviceClient: h.service.client, now: NOW });
    expect(feed.items.map((i) => i.kind)).toEqual([
      "social_escalation",
      "voice_booking",
      "post_failed",
      "invoice_problem",
      "voice_escalation",
      "payment_failed",
      "employee_escalation",
      "employee_billing_past_due",
      "employee_escalation"
    ]);
    const byId = Object.fromEntries(feed.items.map((i) => [i.id, i]));
    expect(byId["event:91"]).toMatchObject({ href: "/social", detail: "طلب استرجاع" });
    expect(byId["event:92"]).toMatchObject({ href: "/voice", detail: "يريد التحدث لمسؤول" });
    expect(byId["event:93"].href).toBe(`/employees/${EMPLOYEE_ID}`);
    expect(Array.from(byId["event:93"].detail!).length).toBeLessThanOrEqual(141);
    expect(byId["event:94"].href).toBe("/employees"); // never a link built from an unchecked payload value
    expect(byId["invoice:inv-1"]).toMatchObject({ href: "/invoices/inv-1", detail: "INV-0042" });
    expect(byId["booking:bk-1"]).toMatchObject({ href: "/voice", detail: "سارة · الأحد ٥م" });
    expect(byId["payment:pay-1"].href).toBe("/billing");
    for (const item of feed.items) expect(item.title.ar && item.title.en).toBeTruthy();
    expect(feed.unread_count).toBe(feed.items.length); // never opened → everything unread
  });

  it("reads escalations with the service role scoped to the merchant, everything else via RLS", async () => {
    await loadNotifications({ merchant: merchant(), userClient: h.user.client, serviceClient: h.service.client, now: NOW });
    expect(h.service.calls.map((c) => c.table)).toEqual(["events"]);
    const events = h.service.calls[0];
    expect(h.service.filter(events, "merchant")).toBe(MERCHANT_ID);
    expect(h.service.filter(events, "kind")).toEqual(["social.escalation", "voice.escalation", "employee.escalation"]);
    expect(String(h.service.filter(events, "created_at"))).toBe("2026-10-07T09:00:00.000Z");
    for (const call of h.user.calls) expect(h.user.filter(call, "merchant_id")).toBe(MERCHANT_ID);
  });

  it("counts only items newer than the read cursor — no dot when nothing is new", async () => {
    sources("2026-11-05T12:00:00Z");
    const feed = await loadNotifications({ merchant: merchant(), userClient: h.user.client, serviceClient: h.service.client, now: NOW });
    expect(feed.unread_count).toBe(2);
    expect(feed.items.filter((i) => i.unread).map((i) => i.id)).toEqual(["event:91", "booking:bk-1"]);

    sources("2026-11-06T09:00:00Z");
    expect((await loadNotifications({ merchant: merchant(), userClient: h.user.client, serviceClient: h.service.client, now: NOW })).unread_count).toBe(0);
  });

  it("lists a past-due subscription while it lasts", async () => {
    const feed = await loadNotifications({
      merchant: merchant({ subscription_status: "past_due", subscription_expires_at: "2026-11-05T00:00:00Z" }),
      userClient: h.user.client,
      serviceClient: h.service.client,
      now: NOW
    });
    expect(feed.items.find((i) => i.kind === "subscription_past_due")).toMatchObject({ href: "/billing", at: "2026-11-05T00:00:00Z" });
  });

  it("fails loudly (no silent empty bell) when a source cannot be read", async () => {
    h.userHandler = (call) => (call.table === "invoices" ? { error: { message: "boom" } } : undefined);
    await expect(
      loadNotifications({ merchant: merchant(), userClient: h.user.client, serviceClient: h.service.client, now: NOW })
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("buildFeed", () => {
  it("caps and orders", () => {
    const drafts = Array.from({ length: 30 }, (_, i) => ({
      id: `x:${i}`,
      kind: "post_failed" as const,
      at: new Date(Date.UTC(2026, 10, 1, i)).toISOString(),
      href: "/social",
      title: { ar: "a", en: "b" },
      detail: null
    }));
    const feed = buildFeed(drafts, null, 20);
    expect(feed.items).toHaveLength(20);
    expect(feed.items[0].id).toBe("x:29");
  });
});

describe("GET /api/notifications", () => {
  it("401 / 403 / 200", async () => {
    h.signedIn = false;
    expect((await getFeed()).status).toBe(401);
    h.signedIn = true;
    h.merchant = null;
    expect((await getFeed()).status).toBe(403);
    h.merchant = merchant();
    const res = await getFeed();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json.items.length).toBeGreaterThan(0);
  });
});

describe("POST /api/notifications/read", () => {
  const post = (body: unknown) => markRead(jsonRequest("http://localhost/api/notifications/read", body));

  it("moves the cursor through the RLS-scoped RPC for the session's merchant", async () => {
    // the user client carries the RPC (security invoker): never the service role
    h.user = createFakeSupabase("user", () => undefined, (fn) => (fn === "mark_notifications_seen" ? h.rpcResult : undefined));
    const res = await post({ up_to: "2026-11-06T08:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, last_seen_at: "2026-11-06T08:00:00+00:00" });
    expect(h.user.rpcCalls).toEqual([{ fn: "mark_notifications_seen", args: { p_merchant_id: MERCHANT_ID, p_up_to: "2026-11-06T08:00:00.000Z" } }]);
    expect(h.service.rpcCalls).toEqual([]);
  });

  it("an empty body marks everything up to now", async () => {
    h.user = createFakeSupabase("user", () => undefined, () => h.rpcResult);
    const res = await markRead(new NextRequest("http://localhost/api/notifications/read", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(h.user.rpcCalls[0].args).toEqual({ p_merchant_id: MERCHANT_ID, p_up_to: null });
  });

  it("400 for a malformed timestamp or body", async () => {
    expect((await post({ up_to: "yesterday" })).status).toBe(400);
    const res = await markRead(new NextRequest("http://localhost/api/notifications/read", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });
});
