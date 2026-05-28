"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

function BillingCompleteInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<"verifying" | "success" | "error">("verifying");

  useEffect(() => {
    const paymentId = searchParams.get("id");
    const intentId = searchParams.get("intent");
    if (!paymentId || !intentId) {
      setState("error");
      return;
    }

    (async () => {
      try {
        await apiFetch("/api/billing/confirm", {
          method: "POST",
          body: JSON.stringify({ paymentId, intentId })
        });
        setState("success");
        toast("Subscription activated", "success");
        setTimeout(() => router.replace("/dashboard"), 1500);
      } catch (err) {
        setState("error");
        toast(err instanceof ApiClientError ? err.message : "Payment verification failed", "error");
      }
    })();
  }, [searchParams, router, toast]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        {state === "verifying" && <p className="text-ink-soft">Verifying your Moyasar payment…</p>}
        {state === "success" && <p className="text-ink">Payment confirmed. Redirecting to your dashboard…</p>}
        {state === "error" && (
          <>
            <p className="text-red-700">We could not verify this payment. Try again from billing or contact support.</p>
            <Link href="/billing"><Button>Back to billing</Button></Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function BillingCompletePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading…</div>}>
      <BillingCompleteInner />
    </Suspense>
  );
}
