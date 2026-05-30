"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { TestAllConnectionsButton } from "@/components/admin/connection-test-button";

type Stats = {
  merchants: number;
  invoices: number;
  socialPosts: number;
  socialFailed: number;
  events: number;
  escalations: number;
  billingPayments: number;
  socialChannels: number;
  planCounts: Record<string, number>;
};

export function AdminOverviewClient() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<Stats>("/api/admin/stats");
        setStats(data);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load stats", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  if (loading) {
    return <p className="p-4 md:p-8 pb-24 lg:pb-8 text-sm text-ink-mute">Loading platform stats…</p>;
  }

  if (!stats) return null;

  const cards = [
    { label: "Merchants", value: stats.merchants },
    { label: "Social posts", value: stats.socialPosts },
    { label: "Failed posts", value: stats.socialFailed, warn: stats.socialFailed > 0 },
    { label: "Connected channels", value: stats.socialChannels },
    { label: "Invoices", value: stats.invoices },
    { label: "Escalations", value: stats.escalations },
    { label: "Events", value: stats.events },
    { label: "Payments", value: stats.billingPayments }
  ];

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 space-y-6 overflow-y-auto">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Platform health</CardTitle>
            <CardSubtitle>Run connection tests across Supabase, AI, OAuth, billing, and cron.</CardSubtitle>
          </div>
          <TestAllConnectionsButton />
        </CardHeader>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <p className="text-xs font-mono uppercase tracking-widest text-ink-mute">{c.label}</p>
            <p className="font-display text-3xl mt-2">{c.value}</p>
            {c.warn && (
              <Badge tone="warn" className="mt-2">
                Needs attention
              </Badge>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.planCounts).map(([plan, count]) => (
            <Badge key={plan}>
              {plan}: {count}
            </Badge>
          ))}
          {Object.keys(stats.planCounts).length === 0 && (
            <p className="text-sm text-ink-mute">No merchants yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
