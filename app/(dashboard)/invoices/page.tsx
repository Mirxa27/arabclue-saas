import { Topbar } from "@/components/dashboard/topbar";
import { Badge, Card, Empty } from "@/components/ui/primitives";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Invoice } from "@/lib/types/database";

export default async function InvoicesPage() {
  const merchant = await getCurrentMerchant();
  const supabase = getServerSupabase();
  const { data: invoices } = merchant
    ? await supabase.from("invoices").select("*").eq("merchant_id", merchant.id).order("icv", { ascending: false }).limit(200)
    : { data: [] as Invoice[] };

  const rows = (invoices ?? []) as Invoice[];

  return (
    <>
      <Topbar merchant={merchant} title="ZATCA Invoices" />
      <div className="p-8 overflow-y-auto">
        <Card className="p-0">
          {rows.length === 0 ? (
            <Empty
              title="No invoices generated yet"
              hint="Once your Salla store posts an order, we generate and submit the ZATCA invoice automatically."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/40">
                <tr className="text-left text-xs uppercase tracking-widest text-ink-mute">
                  <th className="px-6 py-3">ICV</th>
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-6 py-3">UUID</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3 text-end">Subtotal</th>
                  <th className="px-6 py-3 text-end">VAT</th>
                  <th className="px-6 py-3 text-end">Total</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id} className="border-t border-rule">
                    <td className="px-6 py-3 font-mono text-xs">{inv.icv}</td>
                    <td className="px-6 py-3 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-6 py-3 font-mono text-xs text-ink-mute">{String(inv.uuid).slice(0, 8)}…</td>
                    <td className="px-6 py-3 text-ink-soft">{new Date(inv.created_at).toLocaleString("en-GB")}</td>
                    <td className="px-6 py-3 text-end nums">{Number(inv.subtotal).toFixed(2)}</td>
                    <td className="px-6 py-3 text-end nums text-ink-soft">{Number(inv.vat).toFixed(2)}</td>
                    <td className="px-6 py-3 text-end nums font-medium">{Number(inv.total).toFixed(2)}</td>
                    <td className="px-6 py-3">
                      <Badge tone={inv.status === "cleared" ? "success" : inv.status === "failed" || inv.status === "rejected" ? "danger" : "default"}>
                        {inv.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
