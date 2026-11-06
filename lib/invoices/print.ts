/**
 * Printable invoice (UI-012 "PDF"): a self-contained, print-optimised bilingual HTML page. The PDF is
 * produced by the browser's own "Print → Save as PDF" (labelled as such on the page) — Arabic text
 * shaping and RTL layout come from the browser, no PDF library is added. The legal e-invoice is the
 * XML (downloadable next to it); this page is its human-readable rendering, with the QR code.
 *
 * Everything interpolated is HTML-escaped; the page loads nothing external and ships a CSP that
 * allows only its own inline style and the hash of its one-line print script.
 */
import { createHash } from "crypto";
import type { ReadInvoice } from "@/lib/zatca/read";
import { INVOICE_STATUS_TEXT } from "@/lib/invoices/labels";
import type { InvoiceStatus } from "@/lib/types/database";

const PRINT_SCRIPT = 'document.getElementById("print").addEventListener("click",function(){window.print()});';
export const PRINT_CSP = [
  "default-src 'none'",
  "img-src data:",
  "style-src 'unsafe-inline'",
  `script-src 'sha256-${createHash("sha256").update(PRINT_SCRIPT).digest("base64")}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'"
].join("; ");

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function title(doc: ReadInvoice): { ar: string; en: string } {
  const simplified = doc.subtype?.startsWith("02");
  if (doc.typeCode === "381") return simplified ? { ar: "إشعار دائن مبسط", en: "Simplified Credit Note" } : { ar: "إشعار دائن", en: "Credit Note" };
  if (doc.typeCode === "383") return simplified ? { ar: "إشعار مدين مبسط", en: "Simplified Debit Note" } : { ar: "إشعار مدين", en: "Debit Note" };
  return simplified ? { ar: "فاتورة ضريبية مبسطة", en: "Simplified Tax Invoice" } : { ar: "فاتورة ضريبية", en: "Tax Invoice" };
}

function address(a: ReadInvoice["seller"]["address"]): string {
  if (!a) return "";
  return [a.building && a.street ? `${a.building} ${a.street}` : a.street, a.district, a.city && a.postalCode ? `${a.city} ${a.postalCode}` : a.city, a.country]
    .filter(Boolean)
    .map(escapeHtml)
    .join("، ");
}

export type PrintInput = {
  doc: ReadInvoice;
  status: InvoiceStatus;
  environment: string | null;
  qrDataUrl: string | null;
};

export function renderInvoicePrintHtml({ doc, status, environment, qrDataUrl }: PrintInput): string {
  const t = title(doc);
  const test = environment && environment !== "production";
  const statusText = INVOICE_STATUS_TEXT[status] ?? { en: status, ar: status };
  const row = (labelAr: string, labelEn: string, value: string | null | undefined) =>
    value ? `<tr><th><span lang="ar">${labelAr}</span><br><span lang="en">${labelEn}</span></th><td dir="auto">${escapeHtml(value)}</td></tr>` : "";
  const lines = doc.lines
    .map(
      (l, i) => `<tr>
        <td>${i + 1}</td>
        <td dir="auto">${escapeHtml(l.name)}</td>
        <td class="num">${escapeHtml(l.quantity)}</td>
        <td class="num">${escapeHtml(l.unitPrice ?? "")}</td>
        <td class="num">${escapeHtml(l.net)}</td>
        <td class="num">${escapeHtml(l.vatPercent ? `${l.vatPercent}%` : "")}</td>
        <td class="num">${escapeHtml(l.vat ?? "")}</td>
        <td class="num">${escapeHtml(l.withVat ?? "")}</td>
      </tr>`
    )
    .join("");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(t.en)} ${escapeHtml(doc.invoiceNumber ?? "")}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "Noto Naskh Arabic", "Segoe UI", Tahoma, Arial, sans-serif; color: #111; margin: 24px; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .en { direction: ltr; unicode-bidi: isolate; color: #555; }
  .bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .test { border: 2px solid #b91c1c; color: #b91c1c; padding: 6px 10px; font-weight: bold; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: start; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; width: 30%; }
  .lines th { width: auto; }
  .num { text-align: end; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
  .qr img { width: 160px; height: 160px; }
  .totals { width: 50%; margin-inline-start: auto; }
  .note { color: #555; font-size: 11px; margin-top: 16px; }
  button { font: inherit; padding: 8px 14px; cursor: pointer; }
  @media print { .no-print { display: none; } body { margin: 0; } }
  @page { size: A4; margin: 14mm; }
</style>
</head>
<body>
<div class="no-print bar">
  <button id="print" type="button">طباعة / حفظ كملف PDF — Print / Save as PDF</button>
  <span class="note">يستخدم نافذة الطباعة في المتصفح. Uses your browser's print dialog ("Save as PDF"). The legal e-invoice is the XML file.</span>
</div>
${test ? `<div class="test">بيئة اختبار (${escapeHtml(environment)}) — ليست فاتورة ضريبية صالحة · ZATCA ${escapeHtml(environment)} environment — test document, not a valid tax invoice</div>` : ""}
<div class="bar">
  <div>
    <h1>${escapeHtml(t.ar)} <span class="en">${escapeHtml(t.en)}</span></h1>
    <div>${escapeHtml(statusText.ar)} · <span class="en">${escapeHtml(statusText.en)}</span></div>
  </div>
  ${qrDataUrl ? `<div class="qr"><img alt="ZATCA QR" src="${escapeHtml(qrDataUrl)}"></div>` : ""}
</div>
<table>
  ${row("رقم الفاتورة", "Invoice number", doc.invoiceNumber)}
  ${row("تاريخ ووقت الإصدار", "Issue date and time", doc.issueDate ? `${doc.issueDate} ${doc.issueTime ?? ""}`.trim() : null)}
  ${row("تاريخ التوريد", "Supply date", doc.supplyDate)}
  ${row("مرجع الفاتورة الأصلية", "Original invoice", doc.billingReference)}
  ${row("سبب الإصدار", "Reason", doc.reason)}
  ${row("المعرّف الفريد", "UUID", doc.uuid)}
</table>
<table>
  ${row("البائع", "Seller", doc.seller.name)}
  ${row("الرقم الضريبي للبائع", "Seller VAT number", doc.seller.vatNumber)}
  ${row("السجل التجاري", "CR number", doc.seller.otherId?.value)}
  <tr><th><span lang="ar">عنوان البائع</span><br><span lang="en">Seller address</span></th><td dir="auto">${address(doc.seller.address)}</td></tr>
  ${doc.buyer ? row("المشتري", "Buyer", doc.buyer.name) : ""}
  ${doc.buyer ? row("الرقم الضريبي للمشتري", "Buyer VAT number", doc.buyer.vatNumber) : ""}
  ${doc.buyer?.address ? `<tr><th><span lang="ar">عنوان المشتري</span><br><span lang="en">Buyer address</span></th><td dir="auto">${address(doc.buyer.address)}</td></tr>` : ""}
</table>
<table class="lines">
  <thead><tr>
    <th>#</th><th>الصنف<br><span class="en">Item</span></th><th>الكمية<br><span class="en">Qty</span></th>
    <th>سعر الوحدة<br><span class="en">Unit price</span></th><th>المبلغ الخاضع<br><span class="en">Net</span></th>
    <th>النسبة<br><span class="en">VAT %</span></th><th>الضريبة<br><span class="en">VAT</span></th>
    <th>الإجمالي<br><span class="en">Total</span></th>
  </tr></thead>
  <tbody>${lines}</tbody>
</table>
<table class="totals">
  ${row("الإجمالي غير شامل الضريبة (ر.س)", "Total excl. VAT (SAR)", doc.totals.taxExclusive)}
  ${row("مجموع ضريبة القيمة المضافة (ر.س)", "Total VAT (SAR)", doc.totals.vat)}
  ${row("الإجمالي شامل الضريبة (ر.س)", "Total incl. VAT (SAR)", doc.totals.taxInclusive)}
</table>
<p class="note">ICV ${escapeHtml(doc.icv ?? "—")} · ${doc.signed ? "موقّعة رقمياً · Cryptographically stamped" : ""}</p>
<script>${PRINT_SCRIPT}</script>
</body>
</html>`;
}
