"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MoyasarCheckout } from "@/components/billing/moyasar-checkout";
import { useMerchant } from "@/hooks/use-merchant";
import { BILLING_PLANS, formatHalalas, type BillingPlan } from "@/lib/billing/plans";
import { apiFetch } from "@/lib/api/client";
import Link from "next/link";
import { Check, Crown, Sparkles, Stars, Zap } from "lucide-react";

const PLAN_ICONS: Record<BillingPlan, React.ElementType> = {
  lite: Zap,
  plus: Sparkles,
  pro: Crown,
};

const PLAN_GRADIENTS: Record<BillingPlan, string> = {
  lite: "from-sky-500 to-cyan-500",
  plus: "from-accent to-accent",
  pro: "from-amber-500 to-orange-500",
};

export default function BillingPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading billing…</div>}>
      <BillingPage />
    </Suspense>
  );
}

function BillingPage() {
  const { merchant } = useMerchant();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPlan = (searchParams.get("plan") as BillingPlan | null) ?? "plus";
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>(
    initialPlan in BILLING_PLANS ? initialPlan : "plus",
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
    <PageShell title="Billing" merchant={merchant}>
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <Card>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <Crown size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">Subscription Plans</h2>
              <p className="text-xs text-ink-mute mt-0.5">Secure card payments via Moyasar (SAR). Billed monthly.</p>
            </div>
          </div>
        </Card>

        {/* Active subscription banner */}
        {subscriptionStatus === "active" && merchant?.plan && (
          <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-sm flex items-center gap-3 text-emerald-500">
            <Check size={18} />
            <div>
              <span className="font-semibold">Active subscription</span>
              <span className="text-emerald-400/70 ml-2 capitalize">— {merchant.plan} plan</span>
            </div>
          </div>
        )}

        {/* Plan selector */}
        <div className="grid sm:grid-cols-3 gap-4">
          {(Object.keys(BILLING_PLANS) as BillingPlan[]).map((p) => {
            const plan = BILLING_PLANS[p];
            const Icon = PLAN_ICONS[p];
            const isSelected = selectedPlan === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setSelectedPlan(p);
                  setShowCheckout(false);
                }}
                className={`text-left p-5 rounded-2xl border-2 transition-all duration-200 ${
                  isSelected
                    ? "border-accent/60 bg-accent/5 shadow-lg shadow-accent/5"
                    : "border-rule/20 bg-paper/60 hover:border-rule/40 hover:bg-paper"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-gradient-to-br ${PLAN_GRADIENTS[p]} text-white shadow-md`}
                >
                  <Icon size={20} />
                </div>
                <h3 className="font-display text-xl capitalize">{plan.name}</h3>
                <p className="text-2xl font-bold text-ink mt-2">{formatHalalas(plan.amountHalalas)}</p>
                <p className="text-[10px] text-ink-mute mt-0.5 uppercase">per month</p>
                <ul className="mt-4 space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-ink-mute">
                      <Check size={12} className="text-accent shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* Checkout */}
        {!showCheckout ? (
          <div className="flex justify-end">
            <Button size="lg" onClick={() => setShowCheckout(true)}>
              <Crown size={16} />
              Pay with Moyasar
            </Button>
          </div>
        ) : (
          <Card>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                <Stars size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink capitalize">{selectedPlan} plan</h3>
                <p className="text-xs text-ink-mute">Enter your card details below.</p>
              </div>
            </div>
            <MoyasarCheckout plan={selectedPlan} onPaid={() => router.push("/dashboard")} />
          </Card>
        )}

        <Card variant="flat">
          <h3 className="text-sm font-semibold text-ink">AI employee billing</h3>
          <p className="mt-2 text-xs text-ink-soft leading-relaxed">
            Platform plans (Lite / Plus / Pro) unlock the marketplace. Each hired employee gets a{" "}
            <strong className="font-medium text-ink">7-day trial</strong>, then bills monthly per seat via
            Moyasar from the employee workspace. Plus includes up to 5 seats; Pro up to 15.
          </p>
          <Link href="/employees" className="inline-block mt-4 text-xs font-semibold text-accent hover:underline">
            Manage my team →
          </Link>
        </Card>
      </div>
    </PageShell>
  );
}