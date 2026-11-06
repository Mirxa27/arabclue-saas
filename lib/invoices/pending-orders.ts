/**
 * The Salla orders waiting for an invoice (public.pending_salla_orders, RB-S3 / SW-2): invoiced once
 * the reason they waited for is gone — the store got linked, the subscription became active, ZATCA
 * onboarding finished, the kill switch was turned back on.
 *
 * Triggers: the end of ZATCA onboarding, every order.created of the store, the "Issue pending
 * invoices" action on the invoices page, and the /api/zatca/sweep cron. claim_pending_salla_orders
 * hands each row to one worker only; the live-invoice-per-order index makes a double issue impossible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/error-reporter";
import { SallaOrderSchema } from "@/lib/types/salla";
import { InvoiceInputError } from "@/lib/zatca/invoice";
import {
  invoiceOrder,
  invoicingReadiness,
  prepareOrderInvoice,
  type InvoicingMerchant,
  type PendingReason,
  type ReadyInvoicing
} from "@/lib/invoices/order-invoicing";

export type PendingRunSummary = {
  claimed: number;
  invoiced: number;
  unmappable: number;
  retryLater: number;
  /** Set when nothing was attempted because the merchant cannot invoice yet. */
  blockedBy: PendingReason | null;
};

type PendingRow = { id: number; salla_order_id: string; order_payload: unknown; attempts: number };

async function finish(sb: SupabaseClient, id: number, patch: Record<string, unknown>) {
  const { error } = await sb.from("pending_salla_orders").update({ ...patch, claimed_at: null }).eq("id", id);
  if (error) throw new Error(`updating pending Salla order ${id} failed: ${error.message}`);
}

/** Attach the store's unlinked orders to the merchant and keep the waiting reason accurate. */
async function markBlocked(sb: SupabaseClient, merchant: InvoicingMerchant, reason: PendingReason) {
  if (merchant.salla_merchant_id) {
    const { error } = await sb
      .from("pending_salla_orders")
      .update({ merchant_id: merchant.id })
      .is("merchant_id", null)
      .eq("salla_store_id", merchant.salla_merchant_id);
    if (error) throw new Error(`attaching pending Salla orders failed: ${error.message}`);
  }
  const { error } = await sb
    .from("pending_salla_orders")
    .update({ reason })
    .eq("merchant_id", merchant.id)
    .eq("status", "pending")
    .neq("reason", reason);
  if (error) throw new Error(`updating pending Salla orders failed: ${error.message}`);
}

export async function processPendingOrders(
  sb: SupabaseClient,
  merchant: InvoicingMerchant,
  opts: { limit?: number; readiness?: ReadyInvoicing } = {}
): Promise<PendingRunSummary> {
  const summary: PendingRunSummary = { claimed: 0, invoiced: 0, unmappable: 0, retryLater: 0, blockedBy: null };
  const readiness = opts.readiness ?? (await invoicingReadiness(sb, merchant));
  if (!readiness.ok) {
    await markBlocked(sb, merchant, readiness.reason);
    summary.blockedBy = readiness.reason;
    return summary;
  }

  const { data, error } = await sb.rpc("claim_pending_salla_orders", {
    p_merchant_id: merchant.id,
    p_store_id: merchant.salla_merchant_id ?? null,
    p_limit: opts.limit ?? 20
  });
  if (error) throw new Error(`claim_pending_salla_orders failed: ${error.message}`);
  const rows = (data ?? []) as PendingRow[];
  summary.claimed = rows.length;

  for (const row of rows) {
    const parsed = SallaOrderSchema.safeParse(row.order_payload);
    if (!parsed.success) {
      await finish(sb, row.id, { status: "unmappable", last_error: "stored order does not match the Salla order model", processed_at: new Date().toISOString() });
      summary.unmappable++;
      continue;
    }
    const prepared = prepareOrderInvoice(parsed.data);
    if (!prepared.ok) {
      await finish(sb, row.id, { status: "unmappable", last_error: prepared.reason, processed_at: new Date().toISOString() });
      summary.unmappable++;
      continue;
    }
    try {
      const result = await invoiceOrder(sb, merchant, readiness, parsed.data, prepared.mapped);
      await finish(sb, row.id, { status: "invoiced", invoice_id: result.invoiceId, last_error: null, processed_at: new Date().toISOString() });
      summary.invoiced++;
    } catch (err) {
      const permanent = err instanceof InvoiceInputError || (err instanceof HttpError && err.status < 500);
      await finish(sb, row.id, {
        status: permanent ? "unmappable" : "pending",
        reason: "issue_failed",
        last_error: (err instanceof Error ? err.message : String(err)).slice(0, 500)
      });
      if (permanent) summary.unmappable++;
      else summary.retryLater++;
      reportError(err, { merchantId: merchant.id, extra: { step: "pending salla order", pending_id: row.id, order_id: row.salla_order_id } });
    }
  }
  return summary;
}

/** How many orders of this merchant are waiting, by reason (for the invoices page). */
export async function pendingOrderCounts(sb: SupabaseClient, merchant: Pick<InvoicingMerchant, "id" | "salla_merchant_id">) {
  // Both ids are interpolated into a PostgREST filter: only plain identifiers are accepted.
  const id = /^[0-9a-f-]{36}$/i.test(merchant.id) ? merchant.id : null;
  if (!id) throw new Error("invalid merchant id");
  const store = merchant.salla_merchant_id && /^[A-Za-z0-9_-]{1,64}$/.test(merchant.salla_merchant_id) ? merchant.salla_merchant_id : null;
  const { data, error } = await sb
    .from("pending_salla_orders")
    .select("reason, status, merchant_id, salla_store_id")
    .in("status", ["pending", "processing", "unmappable"])
    .or(store ? `merchant_id.eq.${id},and(merchant_id.is.null,salla_store_id.eq.${store})` : `merchant_id.eq.${id}`)
    .limit(1000);
  if (error) throw new Error(`pending_salla_orders count failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ reason: PendingReason; status: string }>;
  const waiting = rows.filter((r) => r.status !== "unmappable");
  const byReason: Partial<Record<PendingReason, number>> = {};
  for (const r of waiting) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  return { waiting: waiting.length, needsAttention: rows.length - waiting.length, byReason };
}
