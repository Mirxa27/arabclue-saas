"use client";

/**
 * "Resubmit to ZATCA" (UI-012): resend a document without a ZATCA verdict, or reissue a rejected one
 * as a corrected new document (POST /api/zatca/invoice/[id]), then refresh / open the new invoice.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Result = {
  action: "resubmitted" | "reissued";
  invoiceId: string;
  submission: { status: string; message?: string; errors?: Array<{ code?: string; message?: string }> };
};

export function ResubmitButton({ invoiceId, mode }: { invoiceId: string; mode: "resend" | "reissue" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (mode === "reissue" && !confirm("Issue a corrected copy of this rejected invoice with a new number? / إصدار نسخة مصححة برقم جديد؟")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/zatca/invoice/${invoiceId}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Partial<Result> & { error?: string };
      if (!res.ok) {
        toast(body.error ?? "ZATCA submission failed / تعذر الإرسال إلى زاتكا", "error");
        return;
      }
      const status = body.submission?.status;
      if (status === "reported" || status === "cleared") toast("Accepted by ZATCA / قبلتها زاتكا", "success");
      else if (status === "rejected") toast(body.submission?.errors?.[0]?.message ?? "Rejected by ZATCA / رفضتها زاتكا", "error");
      else toast(body.submission?.message ?? "Not delivered yet — it will be retried / لم تُسلّم بعد", "default");
      if (body.action === "reissued" && body.invoiceId) router.push(`/invoices/${body.invoiceId}`);
      else router.refresh();
    } catch {
      toast("Network error / خطأ في الشبكة", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={mode === "reissue" ? "danger" : "outline"} type="button" onClick={run} disabled={busy}>
      <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
      {mode === "reissue" ? "Reissue corrected / إعادة إصدار" : "Resubmit to ZATCA / إعادة الإرسال"}
    </Button>
  );
}
