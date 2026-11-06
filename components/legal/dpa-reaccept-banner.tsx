"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api/client";

/**
 * Shown in the dashboard when the merchant has not accepted the current Data
 * Processing Agreement (sub-processors or purposes changed). Acceptance is
 * recorded through POST /api/merchant/dpa.
 */
export function DpaReacceptBanner({ version }: { version: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/merchant/dpa", { method: "POST", body: JSON.stringify({ accept: true, version }) });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "تعذّر الحفظ، حاول مرة أخرى · Could not save, please try again");
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label="Data Processing Agreement update" className="mx-4 mt-4 rounded-xl border border-accent bg-paper px-4 py-3 text-sm text-ink">
      <p dir="rtl" className="ar font-medium">
        حدّثنا اتفاقية معالجة البيانات (الموظفون الأذكياء يردّون على عملائك، وقائمة المعالجين الفرعيين كاملة). راجعها ووافق للمتابعة.
      </p>
      <p className="mt-1 text-ink-mute">
        We updated the Data Processing Agreement (AI employees replying to your customers, the full sub-processor list).
        Please review and accept it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href="/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
          اقرأ الاتفاقية · Read the DPA
        </a>
        <Button type="button" size="sm" onClick={accept} disabled={busy}>
          {busy ? "…" : "أوافق · I accept"}
        </Button>
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
