import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Invoice } from "@/lib/types/database";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  QrCode,
  FileCode,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Copy,
  Download,
} from "lucide-react";

const STATUS_ICONS: Record<string, React.ElementType> = {
  cleared: CheckCircle2,
  submitted: Clock,
  generated: Clock,
  rejected: XCircle,
  failed: AlertTriangle,
};

const STATUS_COLORS: Record<string, string> = {
  cleared: "text-emerald-500",
  submitted: "text-accent-warm",
  generated: "text-ink-mute",
  rejected: "text-red-400",
  failed: "text-red-400",
};

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const merchant = await getCurrentMerchant();
  const supabase = getServerSupabase();

  if (!merchant) return notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", params.id)
    .eq("merchant_id", merchant.id)
    .single();

  if (!invoice) return notFound();

  const inv = invoice as Invoice;
  const StatusIcon = STATUS_ICONS[inv.status] ?? Clock;

  const detailRows: { label: string; value: string; mono?: boolean; copyable?: boolean }[] = [
    { label: "Invoice Number", value: inv.invoice_number, mono: true, copyable: true },
    { label: "UUID", value: inv.uuid, mono: true, copyable: true },
    { label: "ICV", value: String(inv.icv), mono: true },
    { label: "Invoice Hash", value: inv.invoice_hash, mono: true, copyable: true },
    { label: "Salla Order ID", value: inv.salla_order_id ?? "—", mono: true },
    { label: "Subtotal", value: `${Number(inv.subtotal).toFixed(2)} SAR` },
    { label: "VAT", value: `${Number(inv.vat).toFixed(2)} SAR` },
    { label: "Total", value: `${Number(inv.total).toFixed(2)} SAR` },
    { label: "Created At", value: new Date(inv.created_at).toLocaleString("en-GB") },
  ];

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <PageShell
      title={
        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 text-ink-mute hover:text-accent transition-colors"
        >
          <ArrowLeft size={16} /> Invoices
        </Link>
      }
      merchant={merchant}
    >
      <div className="space-y-6">
        {/* Header */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${STATUS_COLORS[inv.status] ?? "text-ink-mute"} bg-ink/5 border border-rule/30`}
              >
                <StatusIcon size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">{inv.invoice_number}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge tone="default">{inv.status}</Badge>
                  {inv.salla_order_id && (
                    <span className="text-[10px] font-mono text-ink-mute">
                      Order #{inv.salla_order_id}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline">
                <Download size={14} /> XML
              </Button>
              <Button size="sm" variant="outline">
                <Download size={14} /> PDF
              </Button>
            </div>
          </div>
        </Card>

        {/* Detail Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Detail Table */}
          <Card className="lg:col-span-2 p-0">
            <CardHeader className="px-6 pt-6 pb-4 border-b border-rule/30">
              <CardTitle className="text-lg">Invoice Details</CardTitle>
              <CardSubtitle className="text-xs">
                ZATCA e-invoicing fields
              </CardSubtitle>
            </CardHeader>
            <dl className="divide-y divide-rule/30">
              {detailRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between px-6 py-3.5 gap-4"
                >
                  <dt className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                    {row.label}
                  </dt>
                  <dd className="flex items-center gap-2 text-sm text-ink font-medium text-right">
                    <span className={row.mono ? "font-mono text-xs" : ""}>
                      {row.value}
                    </span>
                    {row.copyable && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(row.value)}
                        className="p-1 rounded hover:bg-paper-deep/50 transition-colors text-ink-mute hover:text-accent"
                        title="Copy to clipboard"
                      >
                        <Copy size={12} />
                      </button>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Sidebar: QR, XML, Response */}
          <div className="space-y-6">
            {/* QR Code */}
            {inv.qr_base64 && (
              <Card className="text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-center gap-2">
                    <QrCode size={16} /> QR Code
                  </CardTitle>
                  <CardSubtitle className="text-xs">ZATCA-compliant validation QR</CardSubtitle>
                </CardHeader>
                <img
                  src={`data:image/png;base64,${inv.qr_base64}`}
                  alt="ZATCA QR"
                  className="mx-auto w-44 h-44 rounded-xl border border-rule/20 p-2"
                />
                <div className="mt-4 pb-6">
                  <Button size="sm" variant="outline">
                    <Download size={14} /> Download QR
                  </Button>
                </div>
              </Card>
            )}

            {/* XML Preview */}
            {inv.xml && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileCode size={16} /> XML
                  </CardTitle>
                  <CardSubtitle className="text-xs">UBL 2.1 compliant XML payload</CardSubtitle>
                </CardHeader>
                <pre className="mx-6 mb-6 p-3 rounded-xl bg-paper-deep/40 border border-rule/30 text-[10px] font-mono text-ink-mute max-h-48 overflow-auto whitespace-pre-wrap break-all select-all">
                  {inv.xml.length > 800 ? `${inv.xml.slice(0, 800)}…` : inv.xml}
                </pre>
              </Card>
            )}

            {/* ZATCA Response */}
            {inv.fatoora_response && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ExternalLink size={16} /> Fatoora Response
                  </CardTitle>
                  <CardSubtitle className="text-xs">ZATCA API response payload</CardSubtitle>
                </CardHeader>
                <pre className="mx-6 mb-6 p-3 rounded-xl bg-paper-deep/40 border border-rule/30 text-[10px] font-mono text-ink-mute max-h-32 overflow-auto whitespace-pre-wrap break-all select-all">
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