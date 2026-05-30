"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, Badge, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type EventRow = {
  id: string;
  kind: string;
  merchant: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const PAGE_SIZE = 20;

export function AdminEventsClient() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialMerchant = searchParams.get("merchant") ?? "";

  const [events, setEvents] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("");
  const [merchant, setMerchant] = useState(initialMerchant);
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (
      nextOffset = offset,
      overrides?: { kind?: string; merchant?: string; search?: string }
    ) => {
      const activeKind = overrides?.kind ?? kind;
      const activeMerchant = overrides?.merchant ?? merchant;
      const activeSearch = overrides?.search ?? search;

      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (activeKind.trim()) qs.set("kind", activeKind.trim());
        if (activeMerchant.trim()) qs.set("merchant", activeMerchant.trim());
        if (activeSearch.trim()) qs.set("search", activeSearch.trim());
        qs.set("limit", String(PAGE_SIZE));
        qs.set("offset", String(nextOffset));

        const res = await apiFetch<{ events: EventRow[]; total: number }>(`/api/admin/events?${qs.toString()}`);
        setEvents(res.events);
        setTotal(res.total);
        setOffset(nextOffset);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load events", "error");
      } finally {
        setLoading(false);
      }
    },
    [kind, merchant, search, offset, toast]
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialMerchant) {
      setMerchant(initialMerchant);
      load(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMerchant]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filter events</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Kind (exact)">
            <Input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="social.escalation" />
          </Field>
          <Field label="Merchant ID">
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="uuid…" />
          </Field>
          <Field label="Search">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="kind or payload" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={() => load(0)}>
            Apply filters
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setKind("");
              setMerchant("");
              setSearch("");
              load(0, { kind: "", merchant: "", search: "" });
            }}
          >
            Clear
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Events {total > 0 && <span className="text-ink-mute font-normal text-base">({total})</span>}
          </CardTitle>
        </CardHeader>
        {loading ? (
          <p className="text-sm text-ink-mute">Loading events…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-ink-mute">No events match your filters.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {events.map((ev) => (
              <li key={ev.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Badge tone={ev.kind.includes("escalation") ? "warn" : "default"}>{ev.kind}</Badge>
                  <span className="text-xs text-ink-mute font-mono">{new Date(ev.created_at).toLocaleString()}</span>
                  {ev.merchant && (
                    <Link href={`/admin/merchants/${ev.merchant}`} className="text-xs font-mono text-accent hover:underline">
                      merchant {ev.merchant.slice(0, 8)}…
                    </Link>
                  )}
                </div>
                <pre className="text-xs bg-paper-deep/50 p-3 overflow-x-auto font-mono text-ink-soft">
                  {JSON.stringify(ev.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-between gap-4">
            <Button variant="ghost" type="button" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <span className="text-xs font-mono text-ink-mute">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => load(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
