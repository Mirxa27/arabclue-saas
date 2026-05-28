"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MoyasarCheckout } from "@/components/billing/moyasar-checkout";
import { useMerchant } from "@/hooks/use-merchant";
import { BILLING_PLANS, formatHalalas, type BillingPlan } from "@/lib/billing/plans";
import { apiFetch } from "@/lib/api/client";
import { Check } from "lucide-react";

export default function BillingPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading billing…</div>}>
      <BillingPage />
    </Suspense>
  );
}

function BillingPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPlan = (searchParams.get("plan") as BillingPlan | null) ?? "plus";
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>(
    initialPlan in BILLING_PLANS ? initialPlan : "plus"
  );
  const [showCheckout, setShowCheckout] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!merchant) return;
    apiFetch<{ subscriptionStatus: string }>("/api/billing/status")
      .then((s) => setSubscriptionStatus(s.subscriptionStatus))
      .catch(() => {});
  }, [merchant]);

  return (
    <PageShell title="Billing" merchant={merchant} loading={loading}>
      <div className="p-8 max-w-2xl space-y-6 overflow-y-auto">
        {subscriptionStatus === "active" && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Check size={18} className="text-accent" />
                  Active subscription
                </CardTitle>
                <CardSubtitle>
                  Plan: <span className="capitalize">{merchant?.plan}</span>. Manage renewal below or change plan.
                </CardSubtitle>
              </div>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Choose a plan</CardTitle>
              <CardSubtitle>Secure card payments via Moyasar (SAR). Billed monthly.</CardSubtitle>
            </div>
          </CardHeader>
          <div className="space-y-3">
            {(Object.keys(BILLING_PLANS) as BillingPlan[]).map((p) => (
              <label
                key={p}
                className={`cursor-pointer border p-4 flex items-center justify-between transition ${
                  selectedPlan === p ? "border-ink bg-paper-deep/40" : "border-rule"
                }`}
              >
                <div>
                  <div className="font-display text-xl capitalize">{BILLING_PLANS[p].name}</div>
                  <div className="text-xs text-ink-mute mt-1">{formatHalalas(BILLING_PLANS[p].amountHalalas)}/mo</div>
                </div>
                <input
                  type="radio"
                  name="billing-plan"
                  checked={selectedPlan === p}
                  onChange={() => {
                    setSelectedPlan(p);
                    setShowCheckout(false);
                  }}
                />
              </label>
            ))}
          </div>
          {!showCheckout ? (
            <Button className="mt-4" onClick={() => setShowCheckout(true)}>
              Pay with Moyasar
            </Button>
          ) : (
            <div className="mt-6 border-t border-rule pt-6">
              <MoyasarCheckout
                plan={selectedPlan}
                onPaid={() => router.push("/dashboard")}
              />
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
