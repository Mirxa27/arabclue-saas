/** The invoice CSV (UI-013 / critic-26): bilingual headers, AST dates, numeric amounts. */
import { toCsv, type CsvColumn } from "@/lib/export/csv";
import type { InvoiceListRow } from "@/lib/invoices/list";
import { INVOICE_STATUS_TEXT, invoiceTypeText, documentTypeText } from "@/lib/invoices/labels";

function astDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

const amount = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export const INVOICE_CSV_COLUMNS: ReadonlyArray<CsvColumn<InvoiceListRow>> = [
  { header: "Invoice number / رقم الفاتورة", value: (r) => r.invoice_number },
  { header: "Invoice type / نوع الفاتورة", value: (r) => invoiceTypeText(r.invoice_type) },
  { header: "Document / المستند", value: (r) => documentTypeText(r.document_type) },
  { header: "Issued (AST) / تاريخ الإصدار", value: (r) => astDateTime(r.issued_at ?? r.created_at) },
  { header: "ICV / عداد الفاتورة", value: (r) => r.icv },
  { header: "UUID / المعرّف الفريد", value: (r) => r.uuid },
  { header: "Buyer / المشتري", value: (r) => r.buyer_name },
  { header: "Buyer VAT / الرقم الضريبي للمشتري", value: (r) => r.buyer_vat_number },
  { header: "Subtotal SAR / المبلغ قبل الضريبة", value: (r) => amount(r.subtotal) },
  { header: "VAT SAR / ضريبة القيمة المضافة", value: (r) => amount(r.vat) },
  { header: "Total SAR / الإجمالي", value: (r) => amount(r.total) },
  { header: "ZATCA status / حالة زاتكا", value: (r) => INVOICE_STATUS_TEXT[r.status]?.en ?? r.status },
  { header: "ZATCA environment / بيئة زاتكا", value: (r) => r.environment ?? "" },
  { header: "Salla order / طلب سلة", value: (r) => r.salla_order_id },
  { header: "Note / ملاحظة", value: (r) => r.status_note }
];

export function invoicesToCsv(rows: ReadonlyArray<InvoiceListRow>): string {
  return toCsv(INVOICE_CSV_COLUMNS, rows);
}
