"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type MerchantDetail = {
  id: string;
  sellerName: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  installedAt: string | null;
  storeUrl: string | null;
  vatNumber: string | null;
  crNumber: string | null;
  dpaAcceptedAt: string | null;
  ownerUserId: string;
  sallaConnected: boolean;
  socialPlatforms: string[];
  voiceEnabled: boolean;
  voicePhone: string | null;
  counts: { invoices: number; socialPosts: number };
  recentEvents: { id: string; kind: string; payload: Record<string, unknown> | null; created_at: string }[];
  billingPayments: { id: string; amount_sar: number | null; status: string | null; created_at: string }[];
};

export function AdminMerchantDetailClient({ merchantId }: { merchantId: string }) {
  const { toast } = useToast();
  const [merchant, setMerchant] = useState<MerchantDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ merchant: MerchantDetail }>(`/api/admin/merchants/${merchantId}`);
        setMerchant(res.merchant);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load merchant", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [merchantId, toast]);

  if (loading) return <p className="p-4 md:p-8 pb-24 lg:pb-8 text-sm text-ink-mute">Loading merchant…</p>;
  if (!merchant) {
    return (
      <div className="p-4 md:p-8 pb-24 lg:pb-8">
        <p className="text-sm text-ink-mute">Merchant not found.</p>
        <Link href="/admin/merchants" className="text-sm text-accent mt-4 inline-block">
          ← Back to merchants
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto space-y-6">
      <Link href="/admin/merchants" className="text-sm text-accent hover:underline">
        ← Merchants
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{merchant.sellerName ?? "Unnamed store"}</CardTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge>{merchant.plan ?? "lite"}</Badge>
            <Badge tone={merchant.sallaConnected ? "success" : "default"}>
              {merchant.sallaConnected ? "Salla connected" : "Salla —"}
            </Badge>
            {merchant.voiceEnabled && <Badge tone="success">Voice live</Badge>}
          </div>
        </CardHeader>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">Merchant ID</dt>
            <dd className="font-mono mt-1">{merchant.id}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">Billing</dt>
            <dd className="mt-1">{merchant.subscriptionStatus ?? "pending"}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">Store URL</dt>
            <dd className="mt-1 break-all">{merchant.storeUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">Installed</dt>
            <dd className="mt-1">{merchant.installedAt ? new Date(merchant.installedAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">VAT / CR</dt>
            <dd className="mt-1 font-mono">{merchant.vatNumber ?? "—"} / {merchant.crNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono uppercase text-ink-mute">Social</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {merchant.socialPlatforms.length
                ? merchant.socialPlatforms.map((p) => <Badge key={p}>{p}</Badge>)
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Invoices", value: merchant.counts.invoices },
          { label: "Social posts", value: merchant.counts.socialPosts },
          { label: "Voice", value: merchant.voicePhone ?? (merchant.voiceEnabled ? "On" : "Off") },
          { label: "DPA", value: merchant.dpaAcceptedAt ? new Date(merchant.dpaAcceptedAt).toLocaleDateString() : "—" }
        ].map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-xs font-mono uppercase text-ink-mute">{stat.label}</p>
            <p className="font-display text-2xl mt-1">{stat.value}</p>
          </Card>
        ))}
      </div>

      {merchant.billingPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-rule text-sm">
            {merchant.billingPayments.map((p) => (
              <li key={p.id} className="py-3 flex justify-between gap-4">
                <span>{p.amount_sar != null ? `${p.amount_sar} SAR` : "—"}</span>
                <span className="text-ink-mute">{p.status ?? "—"} · {new Date(p.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
        </CardHeader>
        {merchant.recentEvents.length === 0 ? (
          <p className="text-sm text-ink-mute">No events for this merchant.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {merchant.recentEvents.map((ev) => (
              <li key={ev.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Badge>{ev.kind}</Badge>
                  <span className="text-xs text-ink-mute font-mono">{new Date(ev.created_at).toLocaleString()}</span>
                </div>
                <pre className="text-xs bg-paper-deep/50 p-3 overflow-x-auto font-mono text-ink-soft">
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Link href={`/admin/events?merchant=${merchant.id}`}>
            <Button variant="ghost" type="button">View all events →</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
