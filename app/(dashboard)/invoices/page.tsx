import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Invoice } from "@/lib/types/database";
import Link from "next/link";
import { ArrowUpRight, Download, Filter, Search } from "lucide-react";

const STATUS_TONES: Record<string, "success" | "danger" | "warn" | "default"> = {
  cleared: "success",
  submitted: "warn",
  generated: "default",
  rejected: "danger",
  failed: "danger",
};

export default async function InvoicesPage() {
  const merchant = await getCurrentMerchant();
  const supabase = getServerSupabase();

  const { data: invoices } = merchant
    ? await supabase
        .from("invoices")
        .select("*")
        .eq("merchant_id", merchant.id)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };

  const rows = (invoices ?? []) as Invoice[];

  const summary = {
    total: rows.length,
    cleared: rows.filter((r) => r.status === "cleared").length,
    totalValue: rows.reduce((s, r) => s + Number(r.total ?? 0), 0),
    pending: rows.filter((r) => r.status === "generated" || r.status === "submitted").length,
  };

  return (
    <PageShell title="ZATCA Invoices" merchant={merchant}>
      <div className="space-y-6">
        {/* Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Invoices", value: String(summary.total) },
            { label: "Cleared", value: String(summary.cleared) },
            { label: "Pending", value: String(summary.pending) },
            {
              label: "Total Value",
              value: `${summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
              unit: "SAR",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="p-4 rounded-2xl bg-paper-deep/20 border border-rule/30"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                {s.label}
              </div>
              <div className="mt-1.5 text-xl font-semibold nums text-ink">
                {s.value}
                {s.unit && (
                  <span className="text-[10px] font-mono font-normal text-ink-mute ml-1">
                    {s.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
            />
            <input
              type="text"
              placeholder="Filter by invoice number or ICV..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-paper-deep/30 border border-rule/40 text-sm text-ink placeholder:text-ink-mute/50 focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
            />
          </div>
          <button
            type="button"
            className="flex items-center gap-2 h-10 px-4 rounded-xl border border-rule/40 text-sm text-ink-soft hover:text-ink hover:border-rule hover:bg-paper-deep/30 transition-all"
          >
            <Filter size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Filter</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-accent text-paper text-sm font-semibold hover:bg-accent-deep transition-colors active:scale-95"
          >
            <Download size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-12 text-center">
              <Empty
                title="No invoices generated yet"
                hint="Once your Salla store posts an order, we auto-generate and submit ZATCA-compliant invoices."
              />
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="bg-paper-deep/35 border-b border-rule/50">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-mute font-mono">
                    <th className="px-6 py-4">ICV</th>
                    <th className="px-6 py-4">Invoice #</th>
                    <th className="px-6 py-4">UUID</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4 text-end">Subtotal</th>
                    <th className="px-6 py-4 text-end">VAT</th>
                    <th className="px-6 py-4 text-end">Total</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/30">
                  {rows.map((inv) => (
                    <tr
                      key={inv.id}
                      className="hover:bg-paper-deep/20 transition-colors duration-200"
                    >
                      <td className="px-6 py-3.5 font-mono text-xs text-ink-mute">
                        {inv.icv}
                      </td>
                      <td className="px-6 py-3.5 font-mono text-xs font-semibold text-ink">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="hover:text-accent underline-offset-2 hover:underline"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-6 py-3.5 font-mono text-xs text-ink-mute">
                        {String(inv.uuid).slice(0, 8)}…
                      </td>
                      <td className="px-6 py-3.5 text-xs text-ink-soft">
                        {new Date(inv.created_at).toLocaleString("en-GB")}
                      </td>
                      <td className="px-6 py-3.5 text-end nums text-ink-soft">
                        {Number(inv.subtotal).toFixed(2)}
                      </td>
                      <td className="px-6 py-3.5 text-end nums text-ink-soft">
                        {Number(inv.vat).toFixed(2)}
                      </td>
                      <td className="px-6 py-3.5 text-end nums font-semibold text-accent">
                        {Number(inv.total).toFixed(2)}
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge tone={STATUS_TONES[inv.status] ?? "default"}>
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-deep transition-colors"
                        >
                          Detail <ArrowUpRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}