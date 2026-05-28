"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import type { BillingPlan } from "@/lib/billing/plans";

type MoyasarInitConfig = {
  element: HTMLElement;
  amount: number;
  currency: string;
  description: string;
  publishable_api_key: string;
  callback_url: string;
  metadata: Record<string, string>;
  on_completed?: (payment: { id: string; status: string }) => void;
  on_failure?: (error: unknown) => void;
};

declare global {
  interface Window {
    Moyasar?: {
      init: (config: MoyasarInitConfig) => void;
    };
  }
}

type IntentResponse = {
  intentId: string;
  plan: BillingPlan;
  amount: number;
  currency: string;
  description: string;
  publishableKey: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

type MoyasarCheckoutProps = {
  plan: BillingPlan;
  onPaid?: (plan: BillingPlan) => void;
};

export function MoyasarCheckout({ plan, onPaid }: MoyasarCheckoutProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<IntentResponse>("/api/billing/intent", {
          method: "POST",
          body: JSON.stringify({ plan })
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
  }, [plan, toast]);

  useEffect(() => {
    if (!sdkReady || !intent || !formRef.current || !window.Moyasar) return;

    formRef.current.innerHTML = "";
    window.Moyasar.init({
      element: formRef.current,
      amount: intent.amount,
      currency: intent.currency,
      description: intent.description,
      publishable_api_key: intent.publishableKey,
      callback_url: intent.callbackUrl,
      metadata: intent.metadata,
      on_completed: async (payment) => {
        try {
          await apiFetch("/api/billing/confirm", {
            method: "POST",
            body: JSON.stringify({ paymentId: payment.id, intentId: intent.intentId })
          });
          toast("Payment confirmed — subscription active", "success");
          onPaid?.(plan);
        } catch (err) {
          toast(err instanceof ApiClientError ? err.message : "Payment verification failed", "error");
        }
      },
      on_failure: (error) => {
        const message = error instanceof Error ? error.message : "Payment failed";
        toast(message, "error");
      }
    });
  }, [sdkReady, intent, plan, onPaid, toast]);

  if (loading) {
    return <p className="text-sm text-ink-mute font-mono">Preparing Moyasar checkout…</p>;
  }

  if (!intent) {
    return <p className="text-sm text-red-700">Checkout unavailable. Check Moyasar keys in environment.</p>;
  }

  return (
    <>
      <Script
        src="https://cdn.moyasar.com/mpf/1.14.0/moyasar.js"
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
      />
      <link rel="stylesheet" href="https://cdn.moyasar.com/mpf/1.14.0/moyasar.css" />
      <div ref={formRef} className="mysr-form" />
    </>
  );
}
