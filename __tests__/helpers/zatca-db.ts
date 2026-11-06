/**
 * In-memory stand-in for the ZATCA tables and functions (test code only), on top of
 * createFakeSupabase: zatca_egs_units, zatca_chain_heads, invoices, pending_salla_orders, merchants,
 * events, platform_settings and the RPCs zatca_append_invoice / claim_pending_salla_orders with the
 * same semantics as the SQL (proved on PostgreSQL by supabase/tests/45–47).
 */
import { randomUUID } from "crypto";
import { createFakeSupabase, type FakeCall } from "./fake-supabase";

const GENESIS = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

type Row = Record<string, unknown>;

function matches(row: Row, filters: FakeCall["filters"]): boolean {
  return filters.every(([op, col, val]) => {
    const v = row[col];
    switch (op) {
      case "eq":
        return v !== null && v !== undefined && String(v) === String(val);
      case "neq":
        return String(v) !== String(val);
      case "is":
        return val === null ? v === null || v === undefined : v === val;
      case "in":
        return Array.isArray(val) && val.map(String).includes(String(v));
      case "lt":
        return v !== null && v !== undefined && String(v) < String(val);
      case "gte":
        return v !== null && v !== undefined && String(v) >= String(val);
      default:
        return true; // or / not / ilike: not modelled (tests that need them assert the call instead)
    }
  });
}

export function zatcaMemoryDb(opts: { features?: Record<string, unknown> } = {}) {
  const tables: Record<string, Row[]> = {
    zatca_egs_units: [],
    zatca_chain_heads: [],
    invoices: [],
    pending_salla_orders: [],
    merchants: [],
    events: [],
    platform_settings: opts.features ? [{ key: "features", value: opts.features }] : []
  };
  let pendingSeq = 0;
  const keyOf: Record<string, string> = { zatca_egs_units: "merchant_id", zatca_chain_heads: "merchant_id", merchants: "id", invoices: "id" };

  function handler(call: FakeCall) {
    const rows = (tables[call.table] ??= []);
    const one = (list: Row[]) => (call.single === "single" ? (list[0] ? { data: list[0] } : { data: null, error: { code: "PGRST116", message: "no rows" } }) : { data: list[0] ?? null });
    switch (call.op) {
      case "select": {
        const found = rows.filter((r) => matches(r, call.filters));
        return call.single ? one(found) : { data: found };
      }
      case "insert": {
        const list = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
        for (const r of list) rows.push({ id: r.id ?? (call.table === "pending_salla_orders" ? ++pendingSeq : randomUUID()), ...r });
        return { data: call.returning ? list : null };
      }
      case "upsert": {
        const r = call.payload as Row;
        const conflict = String(call.options?.onConflict ?? keyOf[call.table] ?? "id").split(",");
        const existing = rows.find((x) => conflict.every((c) => String(x[c]) === String(r[c])));
        if (existing) Object.assign(existing, r, { updated_at: new Date().toISOString() });
        else rows.push({ id: call.table === "pending_salla_orders" ? ++pendingSeq : randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r });
        const saved = existing ?? rows[rows.length - 1];
        return call.single ? { data: saved } : { data: call.returning ? [saved] : null };
      }
      case "update": {
        const found = rows.filter((r) => matches(r, call.filters));
        for (const r of found) Object.assign(r, call.payload as Row, { updated_at: new Date().toISOString() });
        return call.single ? one(found) : { data: call.returning ? found : null };
      }
      case "delete": {
        const removed = rows.filter((r) => matches(r, call.filters));
        tables[call.table] = rows.filter((r) => !removed.includes(r));
        return { data: call.returning ? removed : null };
      }
    }
  }

  function appendInvoice(args: Record<string, unknown>) {
    const merchant = String(args.p_merchant_id);
    const env = String(args.p_environment);
    const invoice = args.p_invoice as Row;
    let head = tables.zatca_chain_heads.find((h) => h.merchant_id === merchant);
    if (!head) {
      const maxIcv = Math.max(0, ...tables.invoices.filter((i) => i.merchant_id === merchant).map((i) => Number(i.icv)));
      head = { merchant_id: merchant, last_icv: maxIcv, last_hash: null, environment: null };
      tables.zatca_chain_heads.push(head);
    }
    const expectedIcv = Number(head.last_icv) + 1;
    const expectedPih = !head.last_hash || head.environment !== env ? GENESIS : String(head.last_hash);
    if (args.p_icv !== expectedIcv || args.p_previous_hash !== expectedPih) {
      return { data: { outcome: "head_moved", icv: expectedIcv, previous_hash: expectedPih } };
    }
    const order = invoice.salla_order_id ? String(invoice.salla_order_id) : null;
    const supersedes = (args.p_supersedes as string | null) ?? null;
    if (order) {
      const live = tables.invoices.find((i) => i.merchant_id === merchant && i.salla_order_id === order && !i.superseded_by && i.id !== supersedes);
      if (live) return { data: { outcome: "duplicate_order", id: live.id } };
    }
    const id = randomUUID();
    if (supersedes) {
      const old = tables.invoices.find((i) => i.id === supersedes && i.merchant_id === merchant && i.status === "rejected" && !i.superseded_by);
      if (!old) return { data: { outcome: "not_supersedable" } };
      old.superseded_by = id;
      old.status_note = `Rejected by ZATCA; reissued as ${invoice.invoice_number} (ICV ${args.p_icv}).`;
    }
    tables.invoices.push({
      ...invoice,
      id,
      merchant_id: merchant,
      salla_order_id: order,
      icv: args.p_icv,
      previous_invoice_hash: args.p_previous_hash,
      environment: env,
      status: "generated",
      document_type: invoice.document_type ?? "invoice",
      reissue_of: supersedes,
      submission_attempts: 0,
      superseded_by: null,
      created_at: new Date().toISOString()
    });
    Object.assign(head, { last_icv: args.p_icv, last_hash: invoice.invoice_hash, last_invoice_id: id, environment: env });
    return { data: { outcome: "inserted", id } };
  }

  function claimPending(args: Record<string, unknown>) {
    const merchant = String(args.p_merchant_id);
    const store = args.p_store_id ? String(args.p_store_id) : null;
    if (store) for (const r of tables.pending_salla_orders) if (!r.merchant_id && r.salla_store_id === store) r.merchant_id = merchant;
    const stale = Date.now() - 10 * 60_000;
    const batch = tables.pending_salla_orders
      .filter((r) => r.merchant_id === merchant && (r.status === "pending" || (r.status === "processing" && new Date(String(r.claimed_at)).getTime() < stale)))
      .sort((a, b) => String(a.received_at ?? "").localeCompare(String(b.received_at ?? "")))
      .slice(0, Number(args.p_limit ?? 20));
    for (const r of batch) Object.assign(r, { status: "processing", claimed_at: new Date().toISOString(), attempts: Number(r.attempts ?? 0) + 1 });
    return { data: batch };
  }

  const rpcCounts: Record<string, number> = {};
  const fake = createFakeSupabase("service", handler, (fn, args) => {
    rpcCounts[fn] = (rpcCounts[fn] ?? 0) + 1;
    if (fn === "zatca_append_invoice") return appendInvoice(args);
    if (fn === "claim_pending_salla_orders") return claimPending(args);
    if (fn === "claim_webhook_event") return { data: "new" };
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { ...fake, tables, rpcCounts };
}

export type ZatcaMemoryDb = ReturnType<typeof zatcaMemoryDb>;
