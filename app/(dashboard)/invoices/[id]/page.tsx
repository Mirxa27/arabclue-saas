/**
 * One ZATCA invoice (UI-002 / UI-012). A Server Component with no event handlers of its own: copy
 * buttons and "Resubmit" are client islands, downloads are plain links to merchant-scoped routes.
 * The QR is rendered from its TLV payload (the payload is not an image). ZATCA's validation
 * warnings/errors and any status note (duplicates, reissues) are shown as stored.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, ExternalLink, FileCode, Printer, QrCode, XCircle } from "lucide-react";
import { PageShell } from "@/components/dashboard/page-shell";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ResubmitButton } from "@/components/invoices/resubmit-button";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge } from "@/components/ui/primitives";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Invoice } from "@/lib/types/database";
import { canResubmit, documentTypeText, INVOICE_STATUS_TEXT, INVOICE_STATUS_TONE, invoiceTypeText } from "@/lib/invoices/labels";
import { readInvoiceXml } from "@/lib/zatca/read";

const STATUS_ICONS: Record<string, React.ElementType> = {
  cleared: CheckCircle2,
  reported: CheckCircle2,
  submitted: Clock,
  generated: Clock,
  rejected: XCircle,
  failed: AlertTriangle
};

const linkClass =
  "inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs rounded-lg font-mono uppercase tracking-wider font-semibold border border-rule/50 text-ink-mute hover:text-ink hover:border-rule/80";

export default async function InvoiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const merchant = await getCurrentMerchant();
  if (!merchant || !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", id).eq("merchant_id", merchant.id).maybeSingle();
  if (error) throw new Error(`invoice lookup failed: ${error.message}`);
  if (!data) notFound();
  const inv = data as Invoice;

  const legalXml = inv.cleared_xml ?? inv.xml;
  const doc = readInvoiceXml(legalXml);
  const qrPayload = doc?.qr ?? inv.qr_base64;
  const qrImage = qrPayload ? await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, width: 320 }) : null;
  const StatusIcon = STATUS_ICONS[inv.status] ?? Clock;
  const statusText = INVOICE_STATUS_TEXT[inv.status] ?? { en: inv.status, ar: inv.status };
  const resubmit = canResubmit(inv.status, { superseded: Boolean(inv.superseded_by), phase2: Boolean(inv.invoice_type) });
  const issued = new Date(inv.issued_at ?? inv.created_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" });

  const detailRows: { label: string; value: string; mono?: boolean; copyable?: boolean }[] = [
    { label: "Invoice number / رقم الفاتورة", value: inv.invoice_number, mono: true, copyable: true },
    { label: "Type / النوع", value: `${invoiceTypeText(inv.invoice_type)} · ${documentTypeText(inv.document_type)}` },
    { label: "UUID", value: inv.uuid, mono: true, copyable: true },
    { label: "ICV", value: String(inv.icv), mono: true },
    { label: "Invoice hash / بصمة الفاتورة", value: inv.invoice_hash, mono: true, copyable: true },
    { label: "Previous hash (PIH)", value: inv.previous_invoice_hash ?? "—", mono: true },
    { label: "Buyer / المشتري", value: inv.buyer_name ?? doc?.buyer?.name ?? "—" },
    { label: "Salla order / طلب سلة", value: inv.salla_order_id ?? "—", mono: true },
    { label: "Subtotal / قبل الضريبة", value: `${Number(inv.subtotal ?? 0).toFixed(2)} SAR` },
    { label: "VAT / الضريبة", value: `${Number(inv.vat ?? 0).toFixed(2)} SAR` },
    { label: "Total / الإجمالي", value: `${Number(inv.total ?? 0).toFixed(2)} SAR` },
    { label: "Issued (Riyadh) / الإصدار", value: issued },
    { label: "ZATCA environment / البيئة", value: inv.environment ?? "—" }
  ];
  const warnings = inv.validation_warnings ?? [];
  const errors = inv.validation_errors ?? [];

  return (
    <PageShell
      title={
        <Link href="/invoices" className="inline-flex items-center gap-2 text-ink-mute hover:text-accent transition-colors">
          <ArrowLeft size={16} /> Invoices
        </Link>
      }
      merchant={merchant}
    >
      <div className="space-y-6">
        {inv.environment && inv.environment !== "production" && (
          <div className="rounded-xl border border-accent-warm/40 bg-accent-warm/5 px-4 py-2 text-xs text-accent-warm-deep">
            ZATCA {inv.environment} environment — a test document, not a valid tax invoice.{" "}
            <span dir="rtl">بيئة اختبار لدى زاتكا — ليست فاتورة ضريبية صالحة.</span>
          </div>
        )}
        {inv.status_note && (
          <div className="rounded-xl border border-rule/40 bg-paper-deep/30 px-4 py-2 text-xs text-ink" dir="auto">
            {inv.status_note}
          </div>
        )}
        {inv.superseded_by && (
          <div className="rounded-xl border border-rule/40 bg-paper-deep/30 px-4 py-2 text-xs text-ink">
            Replaced by a reissued invoice / استُبدلت بفاتورة معاد إصدارها —{" "}
            <Link className="text-accent underline" href={`/invoices/${inv.superseded_by}`}>
              open / فتح
            </Link>
          </div>
        )}

        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-ink-mute bg-ink/5 border border-rule/30">
                <StatusIcon size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">{inv.invoice_number}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "default"}>{statusText.en}</Badge>
                  <span dir="rtl" className="text-xs text-ink-mute">
                    {statusText.ar}
                  </span>
                  {inv.reissue_of && (
                    <Link className="text-[10px] font-mono text-ink-mute underline" href={`/invoices/${inv.reissue_of}`}>
                      reissue of / إعادة إصدار لـ
                    </Link>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a className={linkClass} href={`/api/zatca/invoice/${inv.id}/download?format=xml`} download>
                <Download size={14} /> XML
              </a>
              <a className={linkClass} href={`/api/invoices/${inv.id}/print`} target="_blank" rel="noopener">
                <Printer size={14} /> Print / PDF
              </a>
              {resubmit && <ResubmitButton invoiceId={inv.id} mode={resubmit} />}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-ink-mute">
            &quot;Print / PDF&quot; opens a printable page — save it as PDF from your browser&apos;s print dialog. The XML is the legal e-invoice
            {inv.cleared_xml ? " (as cleared and stamped by ZATCA)" : ""}.{" "}
            <span dir="rtl">«طباعة / PDF» تفتح صفحة قابلة للطباعة — احفظها PDF من نافذة الطباعة. ملف XML هو الفاتورة الإلكترونية النظامية.</span>
          </p>
        </Card>

        {(errors.length > 0 || warnings.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">ZATCA validation / نتيجة التحقق</CardTitle>
              <CardSubtitle className="text-xs">As returned by ZATCA for this document / كما أعادتها زاتكا</CardSubtitle>
            </CardHeader>
            <ul className="px-6 pb-6 space-y-2 text-xs">
              {errors.map((m, i) => (
                <li key={`e${i}`} className="text-red-500" dir="auto">
                  <strong className="font-mono">{m.code ?? "ERROR"}</strong> — {m.message}
                </li>
              ))}
              {warnings.map((m, i) => (
                <li key={`w${i}`} className="text-accent-warm-deep" dir="auto">
                  <strong className="font-mono">{m.code ?? "WARNING"}</strong> — {m.message}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-0">
            <CardHeader className="px-6 pt-6 pb-4 border-b border-rule/30">
              <CardTitle className="text-lg">Invoice details / تفاصيل الفاتورة</CardTitle>
              <CardSubtitle className="text-xs">ZATCA e-invoicing fields</CardSubtitle>
            </CardHeader>
            <dl className="divide-y divide-rule/30">
              {detailRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between px-6 py-3.5 gap-4">
                  <dt className="text-xs font-mono uppercase tracking-wider text-ink-mute">{row.label}</dt>
                  <dd className="flex items-center gap-2 text-sm text-ink font-medium text-right min-w-0">
                    <span className={`${row.mono ? "font-mono text-xs" : ""} break-all`} dir="auto">
                      {row.value}
                    </span>
                    {row.copyable && <CopyButton value={row.value} label={`Copy ${row.label}`} />}
                  </dd>
                </div>
              ))}
            </dl>
            {doc && doc.lines.length > 0 && (
              <div className="overflow-x-auto border-t border-rule/30">
                <table className="w-full text-xs min-w-[520px]">
                  <thead className="text-ink-mute font-mono uppercase">
                    <tr>
                      <th className="px-6 py-3 text-start">Item / الصنف</th>
                      <th className="px-3 py-3 text-end">Qty</th>
                      <th className="px-3 py-3 text-end">Price</th>
                      <th className="px-3 py-3 text-end">Net</th>
                      <th className="px-3 py-3 text-end">VAT</th>
                      <th className="px-6 py-3 text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/20">
                    {doc.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-6 py-2" dir="auto">
                          {l.name}
                        </td>
                        <td className="px-3 py-2 text-end nums">{l.quantity}</td>
                        <td className="px-3 py-2 text-end nums">{l.unitPrice}</td>
                        <td className="px-3 py-2 text-end nums">{l.net}</td>
                        <td className="px-3 py-2 text-end nums">{l.vat}</td>
                        <td className="px-6 py-2 text-end nums">{l.withVat}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="space-y-6">
            {qrImage && (
              <Card className="text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-center gap-2">
                    <QrCode size={16} /> QR Code
                  </CardTitle>
                  <CardSubtitle className="text-xs">{inv.cleared_xml ? "ZATCA's QR (cleared document)" : "Phase-2 QR (tags 1–9)"}</CardSubtitle>
                </CardHeader>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImage} alt="ZATCA QR" className="mx-auto w-44 h-44 rounded-xl border border-rule/20 p-2 bg-white" />
                <div className="mt-4 pb-6">
                  <a className={linkClass} href={`/api/zatca/invoice/${inv.id}/download?format=qr`} download>
                    <Download size={14} /> Download QR
                  </a>
                </div>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCode size={16} /> XML
                </CardTitle>
                <CardSubtitle className="text-xs">
                  {inv.cleared_xml ? "Cleared by ZATCA (legal document)" : "Signed UBL 2.1 document"} — preview; download for the full file
                </CardSubtitle>
              </CardHeader>
              <pre className="mx-6 mb-3 p-3 rounded-xl bg-paper-deep/40 border border-rule/30 text-[10px] font-mono text-ink-mute max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {legalXml.length > 800 ? `${legalXml.slice(0, 800)}…` : legalXml}
              </pre>
              {inv.cleared_xml && (
                <p className="mx-6 mb-6 text-[11px]">
                  <a className="text-accent underline" href={`/api/zatca/invoice/${inv.id}/download?format=signed-xml`} download>
                    Download the document as signed by arabclue
                  </a>
                </p>
              )}
            </Card>

            {inv.fatoora_response && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ExternalLink size={16} /> Fatoora response
                  </CardTitle>
                  <CardSubtitle className="text-xs">
                    {inv.submitted_at ? `Last sent ${new Date(inv.submitted_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}` : "ZATCA API response"}
                    {inv.submission_attempts ? ` · attempts: ${inv.submission_attempts}` : ""}
                  </CardSubtitle>
                </CardHeader>
                <pre className="mx-6 mb-6 p-3 rounded-xl bg-paper-deep/40 border border-rule/30 text-[10px] font-mono text-ink-mute max-h-32 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(inv.fatoora_response, null, 2)}
                </pre>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
