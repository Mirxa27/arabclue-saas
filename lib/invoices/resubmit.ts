/**
 * "Resubmit to ZATCA" from the invoice page (UI-012), following ZATCA's rules for documents that
 * were not accepted (E-invoicing Detailed Technical Guideline, FAQ "Can Taxpayer resubmit a
 * rejected document?"):
 *   - generated / failed / submitted: the document never got a ZATCA verdict → send the same signed
 *     document again (same UUID, hash and ICV; Fatoora answers a repeat submission idempotently);
 *   - rejected: ZATCA keeps the rejected hash and ICV, so the corrected document is a NEW document:
 *     new ICV/UUID/PIH from the chain head, the merchant's current tax details, the number
 *     "<original>-R<n>"; the rejected record stays untouched and points at its reissue.
 *   - reported / cleared: already accepted — nothing to do (a correction needs a credit note).
 * Gated like issuing (SW-2): entitlement, kill switch, configuration, active EGS unit.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, notFound } from "@/lib/api/errors";
import { invoicingReadiness, PENDING_REASON_TEXT, type InvoicingMerchant } from "@/lib/invoices/order-invoicing";
import { zatcaBlockMessage } from "@/lib/zatca/gates";
import { issueDocument, submitInvoice, type StoredIssueInput, type SubmissionSummary, type SubmittableInvoice } from "@/lib/zatca/issue";

export type ResubmitResult =
  | { action: "resubmitted"; invoiceId: string; submission: SubmissionSummary }
  | { action: "reissued"; invoiceId: string; replaces: string; submission: SubmissionSummary };

type StoredInvoice = SubmittableInvoice & {
  merchant_id: string;
  status: string;
  invoice_number: string;
  issue_input: StoredIssueInput | null;
};

export function nextReissueNumber(invoiceNumber: string): string {
  const m = /^(.*)-R(\d+)$/.exec(invoiceNumber);
  return m ? `${m[1]}-R${Number(m[2]) + 1}` : `${invoiceNumber}-R1`;
}

const COLUMNS = "id, merchant_id, uuid, invoice_hash, xml, invoice_type, environment, submission_attempts, superseded_by, status, invoice_number, issue_input";

export async function resubmitInvoice(sb: SupabaseClient, merchant: InvoicingMerchant, invoiceId: string): Promise<ResubmitResult> {
  const { data, error } = await sb.from("invoices").select(COLUMNS).eq("id", invoiceId).eq("merchant_id", merchant.id).maybeSingle();
  if (error) throw new Error(`invoice lookup failed: ${error.message}`);
  const invoice = data as StoredInvoice | null;
  if (!invoice) throw notFound("Invoice");
  if (invoice.superseded_by) throw new HttpError(409, "This invoice was already replaced by a reissued one. / استُبدلت هذه الفاتورة بالفعل.", "superseded");
  if (invoice.status === "reported" || invoice.status === "cleared") {
    throw new HttpError(409, "ZATCA already accepted this invoice. To correct it, issue a credit note. / قبلت زاتكا هذه الفاتورة؛ للتصحيح أصدر إشعاراً دائناً.", "already_accepted");
  }
  if (!invoice.invoice_type) {
    throw new HttpError(409, "This invoice was generated before Phase-2 signing and cannot be submitted. / أُنشئت هذه الفاتورة قبل التوقيع الرقمي ولا يمكن إرسالها.", "legacy_invoice");
  }

  const ready = await invoicingReadiness(sb, merchant);
  if (!ready.ok) {
    switch (ready.reason) {
      case "not_entitled":
        throw new HttpError(402, zatcaBlockMessage("not_entitled"), "plan_required");
      case "zatca_disabled":
      case "zatca_not_configured":
        throw new HttpError(503, zatcaBlockMessage(ready.reason), ready.reason);
      case "zatca_not_onboarded":
        throw new HttpError(409, "Onboard ZATCA in Settings first. / أكمل التسجيل في زاتكا من الإعدادات أولاً.", "onboard_first");
      default:
        throw new HttpError(409, ready.message ?? `${PENDING_REASON_TEXT[ready.reason].en} / ${PENDING_REASON_TEXT[ready.reason].ar}`, ready.reason);
    }
  }

  if (invoice.status !== "rejected") {
    const submission = await submitInvoice(sb, invoice, ready.cfg, ready.material);
    return { action: "resubmitted", invoiceId: invoice.id, submission };
  }

  const input = invoice.issue_input;
  if (!input) throw new HttpError(409, "This invoice cannot be reissued automatically. / لا يمكن إعادة إصدار هذه الفاتورة تلقائياً.", "cannot_reissue");
  const issued = await issueDocument(sb, merchant.id, ready.cfg, ready.material, {
    invoiceType: input.invoiceType,
    documentType: input.documentType,
    invoiceNumber: nextReissueNumber(invoice.invoice_number),
    seller: ready.seller,
    buyer: input.buyer,
    lines: input.lines,
    billingReference: input.billingReference,
    reason: input.reason,
    sallaOrderId: input.sallaOrderId,
    supplyDate: input.supplyDate ? new Date(input.supplyDate) : undefined,
    supersedes: invoice.id
  });
  const { data: fresh, error: freshError } = await sb.from("invoices").select(COLUMNS).eq("id", issued.invoiceId).single();
  if (freshError || !fresh) throw new Error(`loading the reissued invoice failed: ${freshError?.message ?? "not found"}`);
  const submission = await submitInvoice(sb, fresh as StoredInvoice, ready.cfg, ready.material);
  return { action: "reissued", invoiceId: issued.invoiceId, replaces: invoice.id, submission };
}
