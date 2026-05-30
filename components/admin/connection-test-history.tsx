"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type HistoryRow = {
  id: string;
  kind: string;
  payload: {
    service?: string;
    ok?: boolean;
    message?: string;
    latencyMs?: number | null;
    adminEmail?: string | null;
    batchId?: string | null;
    at?: string;
  } | null;
  created_at: string;
};

export function ConnectionTestHistory() {
  const { toast } = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHistory();
    const refresh = () => loadHistory();
    window.addEventListener("arabclue:connection-test", refresh);
    return () => window.removeEventListener("arabclue:connection-test", refresh);
  }, [toast]);

  async function loadHistory() {
    setLoading(true);
    try {
      const res = await apiFetch<{ events: HistoryRow[] }>(
        "/api/admin/events?kind=admin.connection_test&limit=15&offset=0"
      );
      setRows(res.events);
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Failed to load test history", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection test history</CardTitle>
      </CardHeader>
      {loading ? (
        <p className="text-sm text-ink-mute">Loading history…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-mute">No connection tests logged yet. Run a test above to record results.</p>
      ) : (
        <ul className="divide-y divide-rule text-sm">
          {rows.map((row) => {
            const p = row.payload ?? {};
            return (
              <li key={row.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.ok ? "success" : "danger"}>{p.service ?? "unknown"}</Badge>
                  <span className="text-ink-soft">{p.message ?? "—"}</span>
                  {p.latencyMs != null && (
                    <span className="text-xs font-mono text-ink-mute">{p.latencyMs}ms</span>
                  )}
                </div>
                <span className="text-xs font-mono text-ink-mute">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
