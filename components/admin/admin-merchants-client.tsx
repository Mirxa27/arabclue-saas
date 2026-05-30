"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type MerchantRow = {
  id: string;
  sellerName: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  installedAt: string | null;
  sallaConnected: boolean;
  socialPlatforms: string[];
};

export function AdminMerchantsClient() {
  const { toast } = useToast();
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ merchants: MerchantRow[] }>("/api/admin/merchants");
        setMerchants(res.merchants);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load merchants", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  if (loading) return <p className="p-4 md:p-8 pb-24 lg:pb-8 text-sm text-ink-mute">Loading merchants…</p>;

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto">
      <Card>
        <CardHeader>
          <CardTitle>Merchants ({merchants.length})</CardTitle>
        </CardHeader>
        {merchants.length === 0 ? (
          <p className="text-sm text-ink-mute">No merchants registered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-mono uppercase tracking-widest text-ink-mute border-b border-rule">
                  <th className="py-2 pr-4">Store</th>
                  <th className="py-2 pr-4">Plan</th>
                  <th className="py-2 pr-4">Billing</th>
                  <th className="py-2 pr-4">Salla</th>
                  <th className="py-2 pr-4">Social</th>
                  <th className="py-2">Installed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {merchants.map((m) => (
                  <tr key={m.id} className="hover:bg-paper-deep/30">
                    <td className="py-3 pr-4">
                      <Link href={`/admin/merchants/${m.id}`} className="hover:text-accent">
                        <p>{m.sellerName ?? "—"}</p>
                      </Link>
                      <p className="text-xs font-mono text-ink-mute">{m.id.slice(0, 8)}…</p>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge>{m.plan ?? "lite"}</Badge>
                    </td>
                    <td className="py-3 pr-4">{m.subscriptionStatus ?? "pending"}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={m.sallaConnected ? "success" : "default"}>
                        {m.sallaConnected ? "Connected" : "—"}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {m.socialPlatforms.length ? (
                          m.socialPlatforms.map((p) => <Badge key={p}>{p}</Badge>)
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-ink-mute">
                      {m.installedAt ? new Date(m.installedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
