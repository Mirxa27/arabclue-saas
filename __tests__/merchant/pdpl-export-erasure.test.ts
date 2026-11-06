/**
 * PDPL erasure/export (lib/merchant/pdpl.ts):
 *  - RA-14: the export carries the merchant owner's support tickets and feedback (filtered by the
 *    owner's user id, like their RLS policies) and the agent_settings rows.
 *  - RB-S1: Salla deliveries are logged under the Salla store id. Disconnect clears
 *    merchants.salla_merchant_id, so erasure/export must use the store link history
 *    (salla_merchant_event_windows) — not only the current store id — or Disconnect followed by
 *    Delete account leaves the store's events (end-customer PII) behind.
 */
import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { buildMerchantExport, eraseMerchantData, merchantEventKeys, loadSallaStoreWindows } from "@/lib/merchant/pdpl";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000014a2";
const OWNER_ID = "00000000-0000-4000-8000-0000000014a1";
const OLD_STORE = "1305146709";

type Window = { salla_merchant_id: string; from_at: string | null; to_at: string | null };

function fakeDb(opts: { windows?: Window[]; rows?: Record<string, unknown[]>; eventCounts?: Record<string, number> } = {}) {
  const rows = opts.rows ?? {};
  return createFakeSupabase(
    "service",
    (call: FakeCall) => {
      if (call.op === "delete" && call.table === "events") {
        const key = String(call.filters.find(([, c]) => c === "merchant")?.[2]);
        return { count: opts.eventCounts?.[key] ?? 0 };
      }
      if (call.op === "delete") return { count: 0 };
      if (call.op !== "select") return {};
      if (call.single) return { data: null };
      if (call.table === "events") {
        const key = String(call.filters.find(([, c]) => c === "merchant")?.[2]);
        return { data: (rows.events ?? []).filter((e) => (e as { merchant: string }).merchant === key) };
      }
      return { data: rows[call.table] ?? [] };
    },
    (fn) => (fn === "salla_merchant_event_windows" ? { data: opts.windows ?? [] } : { error: { message: `unexpected rpc ${fn}` } })
  );
}

const merchant = (extra: Record<string, unknown> = {}) => ({
  id: MERCHANT_ID,
  owner_user_id: OWNER_ID,
  salla_merchant_id: null as string | null,
  seller_name: "Bait Al Oud",
  cr_number: null as string | null,
  ...extra
});

describe("buildMerchantExport — support, feedback and agent settings (RA-14)", () => {
  it("exports the owner's tickets and feedback (by user id) and the merchant's agent settings", async () => {
    const db = fakeDb({
      rows: {
        support_tickets: [{ id: "t1", user_id: OWNER_ID, message: "طلبي لم يصل", contact_email: "owner@example.test" }],
        user_feedback: [{ id: "f1", user_id: OWNER_ID, sentiment: "down", note: "slow", path: "/invoices" }],
        agent_settings: [{ persona_role: "social", enabled: true, status: "active", last_error: null, overrides: {} }]
      }
    });
    const out = await buildMerchantExport(db.client, merchant());

    expect(out.supportTickets).toEqual([expect.objectContaining({ id: "t1", message: "طلبي لم يصل", contact_email: "owner@example.test" })]);
    expect(out.userFeedback).toEqual([expect.objectContaining({ id: "f1", note: "slow", path: "/invoices" })]);
    expect(out.agentSettings).toEqual([expect.objectContaining({ persona_role: "social", enabled: true })]);

    const byTable = (t: string) => db.calls.find((c) => c.table === t && c.op === "select")!;
    expect(byTable("support_tickets").filters).toEqual([["eq", "user_id", OWNER_ID]]);
    expect(byTable("user_feedback").filters).toEqual([["eq", "user_id", OWNER_ID]]);
    expect(byTable("agent_settings").filters).toEqual([["eq", "merchant_id", MERCHANT_ID]]);
  });

  it("falls back to the merchant id for tickets/feedback when the row has no owner", async () => {
    const db = fakeDb();
    await buildMerchantExport(db.client, merchant({ owner_user_id: null }));
    const byTable = (t: string) => db.calls.find((c) => c.table === t && c.op === "select")!;
    expect(byTable("support_tickets").filters).toEqual([["eq", "merchant_id", MERCHANT_ID]]);
    expect(byTable("user_feedback").filters).toEqual([["eq", "merchant_id", MERCHANT_ID]]);
  });
});

describe("Salla store history in erasure/export (RB-S1)", () => {
  it("erases the events of a store the merchant disconnected before deleting the account", async () => {
    const db = fakeDb({
      windows: [{ salla_merchant_id: OLD_STORE, from_at: null, to_at: null }],
      eventCounts: { [MERCHANT_ID]: 3, [OLD_STORE]: 5 }
    });
    const report = await eraseMerchantData(db.client, merchant()); // salla_merchant_id already null (Disconnect)
    expect(report.eventsDeleted).toBe(8);

    const deletes = db.calls.filter((c) => c.table === "events" && c.op === "delete");
    expect(deletes.map((c) => c.filters)).toEqual([[["eq", "merchant", MERCHANT_ID]], [["eq", "merchant", OLD_STORE]]]);
    expect(db.rpcCalls).toEqual([{ fn: "salla_merchant_event_windows", args: { p_merchant_id: MERCHANT_ID } }]);
    // the merchant row goes last (cascades)
    const order = db.calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(order[order.length - 1]).toBe("merchants");
  });

  it("bounds a store's events to this merchant's window when another merchant linked it later", async () => {
    const db = fakeDb({
      windows: [{ salla_merchant_id: OLD_STORE, from_at: "2026-01-01T00:00:00+00:00", to_at: "2026-06-01T00:00:00+00:00" }]
    });
    await eraseMerchantData(db.client, merchant());
    const store = db.calls.find((c) => c.table === "events" && c.op === "delete" && c.filters.some(([, , v]) => v === OLD_STORE))!;
    expect(store.filters).toEqual([
      ["eq", "merchant", OLD_STORE],
      ["gte", "created_at", "2026-01-01T00:00:00+00:00"],
      ["lt", "created_at", "2026-06-01T00:00:00+00:00"]
    ]);
  });

  it("exports the disconnected store's events and the link history", async () => {
    const db = fakeDb({
      windows: [{ salla_merchant_id: OLD_STORE, from_at: null, to_at: null }],
      rows: {
        events: [
          { id: 2, kind: "order.updated", merchant: OLD_STORE, payload: { data: { id: 9 } }, created_at: "2026-02-01T00:00:00Z" },
          { id: 1, kind: "voice.inbound_call", merchant: MERCHANT_ID, payload: {}, created_at: "2026-01-01T00:00:00Z" }
        ],
        salla_store_links: [{ salla_merchant_id: OLD_STORE, linked_at: "2025-12-01T00:00:00Z", unlinked_at: "2026-03-01T00:00:00Z" }]
      }
    });
    const out = await buildMerchantExport(db.client, merchant());
    expect((out.events as Array<{ id: number }>).map((e) => e.id)).toEqual([1, 2]); // both keys, oldest first
    expect(out.sallaStoreLinks).toEqual([expect.objectContaining({ salla_merchant_id: OLD_STORE })]);
    const links = db.calls.find((c) => c.table === "salla_store_links")!;
    expect(links.filters).toEqual([["eq", "merchant_id", MERCHANT_ID]]);
  });

  it("still covers the current store when the history has no row for it", async () => {
    const db = fakeDb({ windows: [] });
    const windows = await loadSallaStoreWindows(db.client, merchant({ salla_merchant_id: "777" }));
    expect(windows).toEqual([{ storeId: "777", from: null, to: null }]);
    expect(merchantEventKeys(merchant({ salla_merchant_id: "777" }), [{ storeId: OLD_STORE, from: null, to: null }])).toEqual([
      MERCHANT_ID,
      "777",
      OLD_STORE
    ]);
  });

  it("fails loudly when the history cannot be read (no partial erasure)", async () => {
    const db = createFakeSupabase("service", () => ({ count: 0 }), () => ({ error: { message: "permission denied" } }));
    await expect(eraseMerchantData(db.client, merchant())).rejects.toThrow(/salla store history/);
    expect(db.calls.filter((c) => c.op === "delete")).toHaveLength(0);
  });
});
