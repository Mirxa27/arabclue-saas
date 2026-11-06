/**
 * Periodic ZATCA housekeeping (GET/POST /api/zatca/sweep, CRON_SECRET):
 *   1. resend documents that never got a ZATCA verdict (generated / failed / submitted) — simplified
 *      invoices must be reported within 24 hours of issue;
 *   2. invoice Salla orders that were waiting (pending_salla_orders), incl. orders of stores that
 *      have been linked since;
 *   3. prune unlinked pending orders older than the 30-day claim window.
 * Bounded per run and time-budgeted; merchants who cannot invoice (unpaid, not onboarded, kill
 * switch) are skipped — their documents and orders simply wait.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/error-reporter";
import { INVOICING_MERCHANT_COLUMNS, invoicingReadiness, type InvoicingMerchant } from "@/lib/invoices/order-invoicing";
import { processPendingOrders } from "@/lib/invoices/pending-orders";
import { submitInvoice, type SubmittableInvoice } from "@/lib/zatca/issue";

const RESEND_BATCH = 50;
const MAX_SUBMISSION_ATTEMPTS = 12;
const RESEND_AFTER_MS = 10 * 60_000;
const RESEND_WINDOW_DAYS = 14;
const PENDING_MERCHANTS = 25;
const UNLINKED_RETENTION_DAYS = 30;

export type SweepSummary = {
  resent: number;
  resendFailed: number;
  pendingInvoiced: number;
  pendingWaiting: number;
  merchantsSkipped: number;
  prunedUnlinked: number;
  stoppedEarly: boolean;
};

async function loadMerchants(sb: SupabaseClient, filter: { ids?: string[]; stores?: string[] }): Promise<InvoicingMerchant[]> {
  let query = sb.from("merchants").select(INVOICING_MERCHANT_COLUMNS);
  if (filter.ids) query = query.in("id", filter.ids);
  if (filter.stores) query = query.in("salla_merchant_id", filter.stores);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(`merchant lookup failed: ${error.message}`);
  return (data ?? []) as InvoicingMerchant[];
}

export async function runZatcaSweep(sb: SupabaseClient, opts: { budgetMs?: number; now?: () => number } = {}): Promise<SweepSummary> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? 45_000);
  const summary: SweepSummary = { resent: 0, resendFailed: 0, pendingInvoiced: 0, pendingWaiting: 0, merchantsSkipped: 0, prunedUnlinked: 0, stoppedEarly: false };
  const outOfTime = () => {
    if (now() > deadline) summary.stoppedEarly = true;
    return summary.stoppedEarly;
  };

  // 1. documents without a ZATCA verdict
  const resendBefore = new Date(now() - RESEND_AFTER_MS).toISOString();
  const since = new Date(now() - RESEND_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: unsent, error: unsentError } = await sb
    .from("invoices")
    .select("id, merchant_id, uuid, invoice_hash, xml, invoice_type, environment, submission_attempts, superseded_by")
    .in("status", ["generated", "failed", "submitted"])
    .is("superseded_by", null)
    .not("invoice_type", "is", null)
    .lt("submission_attempts", MAX_SUBMISSION_ATTEMPTS)
    .gte("created_at", since)
    .or(`submitted_at.is.null,submitted_at.lt."${resendBefore}"`)
    .order("created_at", { ascending: true })
    .limit(RESEND_BATCH);
  if (unsentError) throw new Error(`unsent invoices lookup failed: ${unsentError.message}`);
  const byMerchant = new Map<string, Array<SubmittableInvoice & { merchant_id: string }>>();
  for (const inv of (unsent ?? []) as Array<SubmittableInvoice & { merchant_id: string }>) {
    byMerchant.set(inv.merchant_id, [...(byMerchant.get(inv.merchant_id) ?? []), inv]);
  }
  if (byMerchant.size) {
    for (const merchant of await loadMerchants(sb, { ids: [...byMerchant.keys()] })) {
      if (outOfTime()) break;
      const ready = await invoicingReadiness(sb, merchant);
      if (!ready.ok) {
        summary.merchantsSkipped++;
        continue;
      }
      for (const inv of byMerchant.get(merchant.id) ?? []) {
        if (outOfTime()) break;
        if (inv.environment !== ready.cfg.environment) continue;
        try {
          const result = await submitInvoice(sb, inv, ready.cfg, ready.material, { timeoutMs: 15_000 });
          if (result.status === "failed") summary.resendFailed++;
          else summary.resent++;
        } catch (err) {
          summary.resendFailed++;
          reportError(err, { merchantId: merchant.id, extra: { step: "zatca sweep resend", invoice_id: inv.id } });
        }
      }
    }
  }

  // 2. waiting Salla orders: of known merchants, and of stores linked since the order arrived
  if (!outOfTime()) {
    const { data: waiting, error: waitingError } = await sb
      .from("pending_salla_orders")
      .select("merchant_id, salla_store_id")
      .eq("status", "pending")
      .order("received_at", { ascending: true })
      .limit(500);
    if (waitingError) throw new Error(`pending orders lookup failed: ${waitingError.message}`);
    const rows = (waiting ?? []) as Array<{ merchant_id: string | null; salla_store_id: string }>;
    const ids = [...new Set(rows.filter((r) => r.merchant_id).map((r) => r.merchant_id!))].slice(0, PENDING_MERCHANTS);
    const stores = [...new Set(rows.filter((r) => !r.merchant_id).map((r) => r.salla_store_id))].slice(0, PENDING_MERCHANTS);
    const merchants = new Map<string, InvoicingMerchant>();
    if (ids.length) for (const m of await loadMerchants(sb, { ids })) merchants.set(m.id, m);
    if (stores.length) for (const m of await loadMerchants(sb, { stores })) merchants.set(m.id, m);
    for (const merchant of merchants.values()) {
      if (outOfTime()) break;
      try {
        const run = await processPendingOrders(sb, merchant, { limit: 20 });
        summary.pendingInvoiced += run.invoiced;
        summary.pendingWaiting += run.retryLater;
        if (run.blockedBy) summary.merchantsSkipped++;
      } catch (err) {
        reportError(err, { merchantId: merchant.id, extra: { step: "zatca sweep pending orders" } });
      }
    }
  }

  // 3. retention of orders of stores nobody claimed
  const cutoff = new Date(now() - UNLINKED_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: pruned, error: pruneError } = await sb
    .from("pending_salla_orders")
    .delete()
    .is("merchant_id", null)
    .lt("received_at", cutoff)
    .select("id");
  if (pruneError) reportError(new Error(`pruning unlinked pending orders failed: ${pruneError.message}`), { extra: { step: "zatca sweep prune" } });
  else summary.prunedUnlinked = (pruned ?? []).length;

  return summary;
}
