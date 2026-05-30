"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type IntentResponse = {
  intentId: string;
  employeeId: string;
  amount: number;
  currency: string;
  description: string;
  publishableKey: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

type MoyasarWindow = Window & {
  Moyasar?: { init: (config: Record<string, unknown>) => void };
};

export function EmployeeBillingCheckout({
  employeeId,
  onPaid
}: {
  employeeId: string;
  onPaid?: () => void;
}) {
  const formRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<IntentResponse>("/api/employees/billing/intent", {
          method: "POST",
          body: JSON.stringify({ employeeId })
        });
        if (!cancelled) setIntent(data);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Could not start checkout", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, toast]);

  useEffect(() => {
    if (!sdkReady || !intent || !formRef.current) return;
    const Moyasar = (window as MoyasarWindow).Moyasar;
    if (!Moyasar) return;
    formRef.current.innerHTML = "";
    Moyasar.init({
      element: formRef.current,
      amount: intent.amount,
      currency: intent.currency,
      description: intent.description,
      publishable_api_key: intent.publishableKey,
      callback_url: intent.callbackUrl,
      metadata: intent.metadata as Record<string, string>
    });
  }, [sdkReady, intent]);

  if (loading) {
    return <p className="text-sm text-ink-mute py-4">Loading checkout…</p>;
  }

  if (!intent) {
    return <p className="text-sm text-accent-warm py-4">Could not load payment form.</p>;
  }

  return (
    <>
      <Script
        src="https://cdn.moyasar.com/mpf/1.7.2/moyasar.min.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
      />
      <link rel="stylesheet" href="https://cdn.moyasar.com/mpf/1.7.2/moyasar.css" />
      <div ref={formRef} className="min-h-[120px]" />
      {onPaid && (
        <p className="mt-2 text-[10px] text-ink-mute">
          After payment you&apos;ll return here automatically.
        </p>
      )}
    </>
  );
}
