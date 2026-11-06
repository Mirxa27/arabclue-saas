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

const PAGE_SIZE = 50;

export function AdminMerchantsClient() {
  const { toast } = useToast();
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (search) qs.set("q", search);
        const res = await apiFetch<{ merchants: MerchantRow[]; total: number }>(`/api/admin/merchants?${qs}`);
        setMerchants(res.merchants);
        setTotal(res.total);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load merchants", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast, offset, search]);

  const from = total === 0 ? 0 : offset + 1;
  const to = offset + merchants.length;

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 overflow-y-auto">
      <Card>
        <CardHeader>
          <CardTitle>
            Merchants ({from}–{to} of {total})
          </CardTitle>
        </CardHeader>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(query.trim());
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search store name or merchant id"
            className="min-w-[220px] flex-1 rounded-xl border border-rule bg-paper px-3 py-2 text-sm"
            aria-label="Search merchants"
          />
          <button type="submit" className="rounded-xl border border-rule px-3 py-2 text-sm">
            Search
          </button>
        </form>
        {loading ? (
          <p className="text-sm text-ink-mute">Loading merchants…</p>
        ) : merchants.length === 0 ? (
          <p className="text-sm text-ink-mute">{search ? "No merchants match this search." : "No merchants registered yet."}</p>
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
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              className="rounded-xl border border-rule px-3 py-2 disabled:opacity-40"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span className="text-ink-mute">
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            <button
              type="button"
              className="rounded-xl border border-rule px-3 py-2 disabled:opacity-40"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
