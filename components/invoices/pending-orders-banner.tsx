"use client";

/**
 * Salla orders waiting for an invoice (RB-S3 / SW-2) — counts come from the server; "Issue pending
 * invoices" invoices a batch now (POST /api/invoices/pending).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type PendingReasonLine = { reason: string; count: number; en: string; ar: string };

export function PendingOrdersBanner({ waiting, needsAttention, reasons, canIssue }: { waiting: number; needsAttention: number; reasons: PendingReasonLine[]; canIssue: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (waiting === 0 && needsAttention === 0) return null;

  async function issue() {
    setBusy(true);
    try {
      const res = await fetch("/api/invoices/pending", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { invoiced?: number; error?: string };
      if (!res.ok) toast(body.error ?? "Could not issue the pending invoices / تعذر الإصدار", "error");
      else toast(`${body.invoiced ?? 0} invoice(s) issued / فواتير صدرت`, "success");
      router.refresh();
    } catch {
      toast("Network error / خطأ في الشبكة", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-accent-warm/30 bg-accent-warm/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
      <div className="flex items-start gap-3">
        <Clock size={18} className="text-accent-warm mt-0.5 shrink-0" />
        <div className="text-sm text-ink">
          <p>
            {waiting} Salla order(s) are waiting for a ZATCA invoice.
            {needsAttention > 0 ? ` ${needsAttention} could not be invoiced automatically.` : ""}
          </p>
          <p dir="rtl" className="ar text-ink-soft">
            {waiting} طلب من سلة بانتظار إصدار فاتورة زاتكا.
            {needsAttention > 0 ? ` ${needsAttention} لم يمكن إصدارها تلقائياً.` : ""}
          </p>
          <ul className="mt-1 text-xs text-ink-mute space-y-0.5">
            {reasons.map((r) => (
              <li key={r.reason}>
                {r.count} × {r.en} · <span dir="rtl">{r.ar}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {canIssue && waiting > 0 && (
        <Button size="sm" type="button" onClick={issue} disabled={busy}>
          {busy ? "Issuing… / جارٍ الإصدار" : "Issue pending invoices / إصدار الفواتير المعلقة"}
        </Button>
      )}
    </div>
  );
}
