/**
 * Salla order.created → ZATCA invoice (the invoicing part of POST /api/salla/webhook).
 *
 *  - The store's merchant is looked up on the service role; a database error throws (→ 5xx, the
 *    webhook claim is released and Salla redelivers). No merchant = the store is installed but not
 *    linked/claimed, or was disconnected: the order is recorded for later (RB-S3), not dropped.
 *  - A payload that is not the documented order model, or does not reconcile with its own totals,
 *    or carries 0% lines, is recorded as unmapped (redelivering it would not change it).
 *  - Not entitled / kill switch off / not configured / not onboarded / seller profile incomplete:
 *    the order waits in pending_salla_orders (SW-2) — never invoiced for free, never lost.
 *  - Otherwise the invoice is issued (atomic ICV/PIH, one live invoice per order) and reported or
 *    cleared; then a bounded batch of the merchant's waiting orders is invoiced too.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/error-reporter";
import { logSallaEvent } from "@/lib/salla/app-events";
import type { SallaWebhookEvent } from "@/lib/salla/oauth";
import { SallaOrderCreatedEventSchema } from "@/lib/types/salla";
import {
  INVOICING_MERCHANT_COLUMNS,
  invoiceOrder,
  invoicingReadiness,
  prepareOrderInvoice,
  recordPendingOrder,
  type InvoicingMerchant,
  type OrderInvoiceResult,
  type PendingReason
} from "@/lib/invoices/order-invoicing";
import { processPendingOrders } from "@/lib/invoices/pending-orders";

const ROUTE = "POST /api/salla/webhook";

export type SallaOrderOutcome =
  | OrderInvoiceResult
  | { outcome: "pending"; reason: PendingReason }
  | { outcome: "unmapped"; reason: string };

function orderIdOf(evt: SallaWebhookEvent): string | null {
  const data = evt.data;
  return data && typeof data === "object" && "id" in data ? String((data as { id?: unknown }).id ?? "") || null : null;
}

/** Recorded for the merchant/ops (events log + error report); not retried. */
async function recordUnmapped(sb: SupabaseClient, owner: string, evt: SallaWebhookEvent, reason: string, detail: Record<string, unknown>) {
  const orderId = orderIdOf(evt);
  reportError(new Error(`Salla order.created not invoiced: ${reason}`), { route: ROUTE, merchantId: owner, extra: { reason, order_id: orderId, ...detail } });
  await logSallaEvent(sb, "salla.order.unmapped", owner, { reason, order_id: orderId, ...detail });
}

export async function handleSallaOrderCreated(sb: SupabaseClient, evt: SallaWebhookEvent): Promise<SallaOrderOutcome> {
  const storeId = String(evt.merchant);
  const { data: merchantRow, error: merchantError } = await sb
    .from("merchants")
    .select(INVOICING_MERCHANT_COLUMNS)
    .eq("salla_merchant_id", storeId)
    .maybeSingle();
  if (merchantError) throw new Error(`merchant lookup for Salla store ${storeId} failed: ${merchantError.message}`);
  const merchant = (merchantRow as InvoicingMerchant | null) ?? null;
  const owner = merchant?.id ?? storeId;

  const parsed = SallaOrderCreatedEventSchema.safeParse(evt);
  if (!parsed.success) {
    await recordUnmapped(sb, owner, evt, "invalid_payload", { issues: parsed.error.issues.slice(0, 8).map((i) => i.path.join(".")) });
    return { outcome: "unmapped", reason: "invalid_payload" };
  }
  const order = parsed.data.data;
  const prepared = prepareOrderInvoice(order);
  if (!prepared.ok) {
    await recordUnmapped(sb, owner, evt, prepared.reason, prepared.detail);
    return { outcome: "unmapped", reason: prepared.reason };
  }
  const notable = prepared.mapped.warnings.filter((w) => w !== "unit_price_below_halala");
  if (notable.length) {
    reportError(new Error("Salla order mapped with warnings"), {
      route: ROUTE,
      merchantId: owner,
      extra: { order_id: String(order.id), warnings: notable, rounding: prepared.mapped.roundingDifference }
    });
  }

  if (!merchant) {
    await recordPendingOrder(sb, { storeId, merchantId: null, order, reason: "store_unlinked" });
    return { outcome: "pending", reason: "store_unlinked" };
  }

  const ready = await invoicingReadiness(sb, merchant);
  if (!ready.ok) {
    await recordPendingOrder(sb, { storeId, merchantId: merchant.id, order, reason: ready.reason, message: ready.message });
    return { outcome: "pending", reason: ready.reason };
  }

  const result = await invoiceOrder(sb, merchant, ready, order, prepared.mapped);

  // Orders that waited (unlinked, unpaid, before onboarding) follow the live one — best effort.
  try {
    // small batch: the delivery should answer quickly; the sweep cron drains the rest
    await processPendingOrders(sb, merchant, { limit: 3, readiness: ready });
  } catch (err) {
    reportError(err, { route: ROUTE, merchantId: merchant.id, extra: { step: "pending salla orders" } });
  }
  return result;
}
