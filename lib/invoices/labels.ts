/** Bilingual labels for invoice states and types (client-safe). */
import type { InvoiceStatus } from "@/lib/types/database";

export const INVOICE_STATUS_TEXT: Record<InvoiceStatus, { en: string; ar: string }> = {
  generated: { en: "Signed, not sent", ar: "موقّعة، لم تُرسل" },
  submitted: { en: "Sent, awaiting result", ar: "أُرسلت، بانتظار النتيجة" },
  reported: { en: "Reported to ZATCA", ar: "مُبلّغ عنها لزاتكا" },
  cleared: { en: "Cleared by ZATCA", ar: "معتمدة من زاتكا" },
  rejected: { en: "Rejected by ZATCA", ar: "مرفوضة من زاتكا" },
  failed: { en: "Not delivered — retrying", ar: "لم تُسلّم — إعادة المحاولة" }
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, "success" | "danger" | "warn" | "default"> = {
  generated: "default",
  submitted: "warn",
  reported: "success",
  cleared: "success",
  rejected: "danger",
  failed: "warn"
};

export function invoiceTypeText(type: string | null | undefined): string {
  if (type === "standard") return "Standard tax invoice / فاتورة ضريبية";
  if (type === "simplified") return "Simplified tax invoice / فاتورة ضريبية مبسطة";
  return "Pre-Phase-2 invoice / فاتورة قبل المرحلة الثانية";
}

export function documentTypeText(type: string | null | undefined): string {
  if (type === "credit_note") return "Credit note / إشعار دائن";
  if (type === "debit_note") return "Debit note / إشعار مدين";
  return "Invoice / فاتورة";
}

/** Statuses the "Resubmit to ZATCA" action applies to. */
export function canResubmit(status: InvoiceStatus, opts: { superseded: boolean; phase2: boolean }): "resend" | "reissue" | null {
  if (opts.superseded || !opts.phase2) return null;
  if (status === "generated" || status === "failed" || status === "submitted") return "resend";
  if (status === "rejected") return "reissue";
  return null;
}
