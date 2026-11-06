/**
 * ZATCA invoices (UI-013): search by invoice number / ICV / Salla order / buyer, filter by ZATCA
 * status, export exactly the filtered list as CSV (GET /api/invoices/export, same filters) — a plain
 * GET form, no client handlers needed in this Server Component. Salla orders still waiting for an
 * invoice (RB-S3 / SW-2) are shown above the list.
 */
import Link from "next/link";
import { ArrowUpRight, Download, Filter, Search } from "lucide-react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge, Empty } from "@/components/ui/primitives";
import { PendingOrdersBanner } from "@/components/invoices/pending-orders-banner";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { filterQueryString, INVOICE_STATUSES, listInvoices, parseInvoiceFilter } from "@/lib/invoices/list";
import { INVOICE_STATUS_TEXT, INVOICE_STATUS_TONE } from "@/lib/invoices/labels";
import { pendingOrderCounts } from "@/lib/invoices/pending-orders";
import { PENDING_REASON_TEXT, type PendingReason } from "@/lib/invoices/order-invoicing";
import { reportError } from "@/lib/observability/error-reporter";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";

const fmt = (n: number | null) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InvoicesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = parseInvoiceFilter(await props.searchParams);
  const merchant = await getCurrentMerchant();
  const rows = merchant ? await listInvoices(await getServerSupabase(), merchant.id, filter, 200) : [];

  let pending: Awaited<ReturnType<typeof pendingOrderCounts>> | null = null;
  if (merchant) {
    try {
      pending = await pendingOrderCounts(getServiceSupabase(), merchant);
    } catch (err) {
      reportError(err, { merchantId: merchant.id, extra: { step: "pending order counts" } });
    }
  }

  const summary = {
    total: rows.length,
    accepted: rows.filter((r) => r.status === "cleared" || r.status === "reported").length,
    attention: rows.filter((r) => r.status === "rejected" || r.status === "failed" || r.status === "generated").length,
    totalValue: rows.filter((r) => !r.superseded_by).reduce((s, r) => s + Number(r.total ?? 0), 0)
  };
  const qs = filterQueryString(filter);
  const filtered = Boolean(filter.q || filter.status);

  return (
    <PageShell title="ZATCA Invoices" merchant={merchant}>
      <div className="space-y-6">
        {pending && (
          <PendingOrdersBanner
            waiting={pending.waiting}
            needsAttention={pending.needsAttention}
            canIssue={Boolean(merchant && merchantCanUseFeature(merchant, "zatca"))}
            reasons={(Object.entries(pending.byReason) as Array<[PendingReason, number]>).map(([reason, count]) => ({
              reason,
              count,
              ...PENDING_REASON_TEXT[reason]
            }))}
          />
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Invoices / الفواتير", value: String(summary.total) },
            { label: "Accepted by ZATCA / مقبولة", value: String(summary.accepted) },
            { label: "Need attention / تحتاج متابعة", value: String(summary.attention) },
            { label: "Total value / القيمة الإجمالية", value: fmt(summary.totalValue), unit: "SAR" }
          ].map((s) => (
            <div key={s.label} className="p-4 rounded-2xl bg-paper-deep/20 border border-rule/30">
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">{s.label}</div>
              <div className="mt-1.5 text-xl font-semibold nums text-ink">
                {s.value}
                {s.unit && <span className="text-[10px] font-mono font-normal text-ink-mute ml-1">{s.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        <form method="get" action="/invoices" className="flex items-center gap-3 flex-wrap" role="search">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              type="search"
              name="q"
              defaultValue={filter.q ?? ""}
              maxLength={80}
              dir="auto"
              placeholder="Invoice no., ICV, Salla order or buyer / رقم الفاتورة أو المشتري"
              aria-label="Search invoices"
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-paper-deep/30 border border-rule/40 text-sm text-ink placeholder:text-ink-mute/50 focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
            />
          </div>
          <select
            name="status"
            defaultValue={filter.status ?? ""}
            aria-label="ZATCA status"
            className="h-10 px-3 rounded-xl border border-rule/40 bg-paper-deep/30 text-sm text-ink"
          >
            <option value="">All statuses / كل الحالات</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INVOICE_STATUS_TEXT[s].en} / {INVOICE_STATUS_TEXT[s].ar}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="flex items-center gap-2 h-10 px-4 rounded-xl border border-rule/40 text-sm text-ink-soft hover:text-ink hover:border-rule hover:bg-paper-deep/30 transition-all"
          >
            <Filter size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Filter / تصفية</span>
          </button>
          {filtered && (
            <Link href="/invoices" className="text-xs text-ink-mute hover:text-accent underline-offset-2 hover:underline">
              Clear / مسح
            </Link>
          )}
          <a
            href={`/api/invoices/export${qs ? `?${qs}` : ""}`}
            download
            className="flex items-center gap-2 h-10 px-4 rounded-xl bg-accent text-paper text-sm font-semibold hover:bg-accent-deep transition-colors active:scale-95"
          >
            <Download size={14} strokeWidth={2} />
            <span className="hidden sm:inline">Export CSV / تصدير</span>
          </a>
        </form>

        <Card className="p-0 overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-12 text-center">
              <Empty
                title={filtered ? "No invoices match / لا توجد نتائج" : "No invoices yet / لا توجد فواتير بعد"}
                hint={
                  filtered
                    ? "Try another search or status. / جرّب بحثاً أو حالة أخرى."
                    : "After ZATCA onboarding (Settings), every Salla order gets a signed ZATCA invoice that is reported automatically. / بعد التسجيل في زاتكا تصدر فاتورة موقّعة لكل طلب من سلة."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-paper-deep/35 border-b border-rule/50">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-mute font-mono">
                    <th className="px-6 py-4">ICV</th>
                    <th className="px-6 py-4">Invoice # / رقم</th>
                    <th className="px-6 py-4">Buyer / المشتري</th>
                    <th className="px-6 py-4">Issued / الإصدار</th>
                    <th className="px-6 py-4 text-end">Subtotal</th>
                    <th className="px-6 py-4 text-end">VAT</th>
                    <th className="px-6 py-4 text-end">Total</th>
                    <th className="px-6 py-4">ZATCA</th>
                    <th className="px-6 py-4"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/30">
                  {rows.map((inv) => (
                    <tr key={inv.id} className={`hover:bg-paper-deep/20 transition-colors duration-200 ${inv.superseded_by ? "opacity-60" : ""}`}>
                      <td className="px-6 py-3.5 font-mono text-xs text-ink-mute">{inv.icv}</td>
                      <td className="px-6 py-3.5 font-mono text-xs font-semibold text-ink">
                        <Link href={`/invoices/${inv.id}`} className="hover:text-accent underline-offset-2 hover:underline">
                          {inv.invoice_number}
                        </Link>
                        {inv.environment && inv.environment !== "production" && (
                          <span className="ml-2 text-[9px] uppercase text-accent-warm">{inv.environment}</span>
                        )}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-ink-soft" dir="auto">
                        {inv.buyer_name ?? "—"}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-ink-soft">{new Date(inv.issued_at ?? inv.created_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}</td>
                      <td className="px-6 py-3.5 text-end nums text-ink-soft">{fmt(inv.subtotal)}</td>
                      <td className="px-6 py-3.5 text-end nums text-ink-soft">{fmt(inv.vat)}</td>
                      <td className="px-6 py-3.5 text-end nums font-semibold text-accent">{fmt(inv.total)}</td>
                      <td className="px-6 py-3.5">
                        <Badge tone={INVOICE_STATUS_TONE[inv.status] ?? "default"} title={INVOICE_STATUS_TEXT[inv.status]?.ar}>
                          {INVOICE_STATUS_TEXT[inv.status]?.en ?? inv.status}
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
