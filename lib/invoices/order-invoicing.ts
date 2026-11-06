/**
 * Turning a Salla order into a ZATCA invoice — shared by the order.created webhook
 * (lib/invoices/salla-orders.ts) and the pending-order backlog (lib/invoices/pending-orders.ts).
 *
 *   prepareOrderInvoice   documented order model → invoice lines (lib/salla/order-invoice.ts) plus
 *                         the ZATCA checks: only the KSA standard rate (15%) is invoiced
 *                         automatically — a 0% line needs an exemption reason Salla does not send
 *   invoicingReadiness    SW-2 gates (kill switch, entitlement, configured environment), an active
 *                         EGS unit for that environment and a complete seller profile
 *   recordPendingOrder    an order that cannot be invoiced now is kept, never dropped (RB-S3)
 *   invoiceOrder          issue (atomic ICV/PIH) + submit to ZATCA
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/error-reporter";
import { logSallaEvent } from "@/lib/salla/app-events";
import { mapSallaOrderToInvoice, sallaDateToInstant, type SallaOrderInvoice } from "@/lib/salla/order-invoice";
import type { SallaOrder } from "@/lib/types/salla";
import type { Merchant } from "@/lib/types/database";
import type { ZatcaConfig } from "@/lib/zatca/config";
import { isEgsActiveFor, loadEgsRow, signingMaterial, type SigningMaterial } from "@/lib/zatca/egs-store";
import { zatcaAccess } from "@/lib/zatca/gates";
import { KSA_STANDARD_VAT_RATE, type SellerInfo } from "@/lib/zatca/invoice";
import { issueDocument, submitInvoice, type SubmissionSummary, type SubmittableInvoice } from "@/lib/zatca/issue";
import { describeTaxProfileProblems, sellerFromMerchant, taxProfileProblems } from "@/lib/zatca/seller";

/** The merchants columns invoicing needs (no credentials: EGS material lives in zatca_egs_units). */
export const INVOICING_MERCHANT_COLUMNS =
  "id, salla_merchant_id, plan, subscription_status, seller_name, vat_number, cr_number, seller_address, store_url, salla_store_name, zatca_onboarded_at";

export type InvoicingMerchant = Pick<
  Merchant,
  "id" | "salla_merchant_id" | "plan" | "subscription_status" | "seller_name" | "vat_number" | "cr_number" | "seller_address" | "store_url" | "salla_store_name" | "zatca_onboarded_at"
>;

export type PendingReason = "store_unlinked" | "not_entitled" | "zatca_disabled" | "zatca_not_configured" | "zatca_not_onboarded" | "issue_failed";

export const PENDING_REASON_TEXT: Record<PendingReason, { en: string; ar: string }> = {
  store_unlinked: { en: "Store not linked to an arabclue account yet", ar: "المتجر غير مرتبط بحساب بعد" },
  not_entitled: { en: "Waiting for an active subscription", ar: "بانتظار تفعيل الاشتراك" },
  zatca_disabled: { en: "ZATCA invoicing is paused by the platform", ar: "الفوترة متوقفة مؤقتاً من المنصة" },
  zatca_not_configured: { en: "ZATCA is not configured on this platform", ar: "لم يتم إعداد زاتكا على المنصة" },
  zatca_not_onboarded: { en: "Waiting for ZATCA onboarding", ar: "بانتظار التسجيل في زاتكا" },
  issue_failed: { en: "Issuing failed — will retry", ar: "تعذر الإصدار — ستتم إعادة المحاولة" }
};

// ── preparing the order ─────────────────────────────────────────────────────

export type PreparedOrder =
  | { ok: true; mapped: SallaOrderInvoice }
  | { ok: false; reason: string; detail: Record<string, string | number | boolean | null> };

export function prepareOrderInvoice(order: SallaOrder): PreparedOrder {
  const mapped = mapSallaOrderToInvoice(order);
  if (!mapped.ok) return { ok: false, reason: mapped.reason, detail: mapped.detail };
  const rates = [...new Set(mapped.invoice.lines.map((l) => l.vatRate))];
  if (rates.some((r) => Math.abs(r - KSA_STANDARD_VAT_RATE) > 1e-9)) {
    // ZATCA needs a category (Z/E/O) and an exemption reason code for any 0% line (BR-KSA-CL-04);
    // the order payload carries neither, so the merchant must invoice this order manually.
    return { ok: false, reason: "unsupported_vat_rate", detail: { order_id: String(order.id), rates: rates.map((r) => r * 100).join(",") } };
  }
  return { ok: true, mapped: mapped.invoice };
}

export function invoiceNumberForOrder(order: Pick<SallaOrder, "id" | "reference_id">): string {
  return `INV-${String(order.reference_id ?? order.id).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60)}`;
}

/** The order as stored while it waits: what the invoice needs, without the customer's contact data. */
export function minimizeOrder(order: SallaOrder): SallaOrder {
  const c = order.customer;
  return {
    ...order,
    customer: c ? { first_name: c.first_name ?? null, last_name: c.last_name ?? null, name: c.name ?? null } : null
  };
}

// ── readiness ──────────────────────────────────────────────────────────────

export type ReadyInvoicing = { ok: true; cfg: ZatcaConfig; material: SigningMaterial; seller: SellerInfo };
export type InvoicingReadiness = ReadyInvoicing | { ok: false; reason: PendingReason; message?: string };

export async function invoicingReadiness(sb: SupabaseClient, merchant: InvoicingMerchant): Promise<InvoicingReadiness> {
  const access = await zatcaAccess(merchant);
  if (!access.ok) return { ok: false, reason: access.reason };
  const row = await loadEgsRow(sb, merchant.id);
  if (!isEgsActiveFor(row, access.config)) return { ok: false, reason: "zatca_not_onboarded" };
  const problems = taxProfileProblems(merchant);
  if (problems.length) return { ok: false, reason: "issue_failed", message: describeTaxProfileProblems(problems) };
  return { ok: true, cfg: access.config, material: signingMaterial(row), seller: sellerFromMerchant(merchant) };
}

// ── pending orders ─────────────────────────────────────────────────────────

export async function recordPendingOrder(
  sb: SupabaseClient,
  args: { storeId: string; merchantId: string | null; order: SallaOrder; reason: PendingReason; message?: string }
): Promise<void> {
  const orderId = String(args.order.id);
  const { data: existing, error: lookupError } = await sb
    .from("pending_salla_orders")
    .select("id, status")
    .eq("salla_store_id", args.storeId)
    .eq("salla_order_id", orderId)
    .maybeSingle();
  if (lookupError) throw new Error(`pending_salla_orders lookup failed: ${lookupError.message}`);
  if ((existing as { status?: string } | null)?.status === "invoiced") return;

  const orderDate = sallaDateToInstant(args.order.date)?.date.toISOString() ?? null;
  const { error } = await sb.from("pending_salla_orders").upsert(
    {
      salla_store_id: args.storeId,
      salla_order_id: orderId,
      merchant_id: args.merchantId,
      reason: args.reason,
      order_payload: minimizeOrder(args.order),
      order_total: args.order.amounts.total.amount,
      order_date: orderDate,
      status: "pending",
      claimed_at: null,
      last_error: args.message ?? null
    },
    { onConflict: "salla_store_id,salla_order_id" }
  );
  if (error) throw new Error(`recording the pending Salla order failed: ${error.message}`);
  await logSallaEvent(sb, "salla.order.pending", args.merchantId ?? args.storeId, { order_id: orderId, reason: args.reason });
}

// ── issuing ────────────────────────────────────────────────────────────────

export type OrderInvoiceResult =
  | { outcome: "invoiced"; invoiceId: string; submission: SubmissionSummary }
  | { outcome: "already_invoiced"; invoiceId: string; submission: SubmissionSummary | null };

const SUBMITTABLE_COLUMNS = "id, uuid, invoice_hash, xml, invoice_type, environment, submission_attempts, superseded_by, status";

async function loadSubmittable(sb: SupabaseClient, invoiceId: string): Promise<SubmittableInvoice & { status: string }> {
  const { data, error } = await sb.from("invoices").select(SUBMITTABLE_COLUMNS).eq("id", invoiceId).single();
  if (error || !data) throw new Error(`loading invoice ${invoiceId} failed: ${error?.message ?? "not found"}`);
  return data as SubmittableInvoice & { status: string };
}

/** Webhook-friendly timeout: a slow ZATCA leaves the invoice 'failed' for the sweep, not the delivery hanging. */
const ORDER_SUBMIT_TIMEOUT_MS = 15_000;

export async function invoiceOrder(
  sb: SupabaseClient,
  merchant: InvoicingMerchant,
  ready: ReadyInvoicing,
  order: SallaOrder,
  mapped: SallaOrderInvoice
): Promise<OrderInvoiceResult> {
  const buyer = mapped.buyer;
  const issued = await issueDocument(sb, merchant.id, ready.cfg, ready.material, {
    invoiceType: buyer?.vatNumber ? "standard" : "simplified",
    documentType: "invoice",
    invoiceNumber: invoiceNumberForOrder(order),
    seller: ready.seller,
    buyer,
    lines: mapped.lines,
    sallaOrderId: String(order.id),
    supplyDate: mapped.issueDate
  });
  const invoice = await loadSubmittable(sb, issued.invoiceId);
  if (issued.outcome === "duplicate_order") {
    // A redelivery: send the existing invoice again only if it never reached ZATCA.
    if ((invoice.status === "generated" || invoice.status === "failed") && invoice.environment === ready.cfg.environment && invoice.invoice_type) {
      const submission = await submitInvoice(sb, invoice, ready.cfg, ready.material, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
      return { outcome: "already_invoiced", invoiceId: issued.invoiceId, submission };
    }
    return { outcome: "already_invoiced", invoiceId: issued.invoiceId, submission: null };
  }
  const submission = await submitInvoice(sb, invoice, ready.cfg, ready.material, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
  if (submission.status === "rejected") {
    reportError(new Error("ZATCA rejected a Salla order invoice"), {
      merchantId: merchant.id,
      extra: { invoice_id: issued.invoiceId, errors: submission.errors.map((e) => e.code).slice(0, 10) }
    });
  }
  return { outcome: "invoiced", invoiceId: issued.invoiceId, submission };
}
