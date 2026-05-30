"use client";

import { useEffect, useState, useMemo } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Badge, Card, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMerchant } from "@/hooks/use-merchant";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { VoiceCallLog } from "@/lib/types/database";
import {
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  MicOff,
  Clock,
  Search,
} from "lucide-react";
import { format, parseISO } from "date-fns";

type FilterDirection = "all" | "inbound" | "outbound";

const DIRECTION_ICONS: Record<string, React.ElementType> = {
  inbound: PhoneIncoming,
  outbound: PhoneOutgoing,
  missed: PhoneMissed,
};

const DIRECTION_COLORS: Record<string, string> = {
  inbound: "text-accent",
  outbound: "text-success",
  missed: "text-danger",
};

const STATUS_TONES: Record<string, "success" | "danger" | "warn" | "default"> = {
  completed: "success",
  missed: "danger",
  failed: "danger",
  voicemail: "warn",
};

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function VoicePage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [calls, setCalls] = useState<VoiceCallLog[]>([]);
  const [config, setConfig] = useState<Record<string, boolean | string>>({});
  const [busy, setBusy] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [direction, setDirection] = useState<FilterDirection>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setDataLoading(false);
      return;
    }
    (async () => {
      setDataLoading(true);
      try {
        const [cs, cl] = await Promise.all([
          apiFetch<{ config?: Record<string, boolean | string> }>("/api/voice/config"),
          apiFetch<{ calls?: VoiceCallLog[] }>("/api/voice/calls?limit=80"),
        ]);
        setConfig(cs.config ?? {});
        setCalls(
          (cl.calls ?? []).sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        );
      } catch (err) {
        toast(
          err instanceof ApiClientError ? err.message : "Failed to load voice data",
          "error"
        );
      } finally {
        setDataLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function toggleAgent() {
    const next = !config.enabled;
    setBusy(true);
    try {
      await apiFetch("/api/voice/config", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next }),
      });
      setConfig((c) => ({ ...c, enabled: next }));
      toast(next ? "Voice agent activated" : "Voice agent paused", "success");
    } catch (err) {
      toast(
        err instanceof ApiClientError ? err.message : "Update failed",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    let list = calls;
    if (direction !== "all")
      list = list.filter((c) => c.direction === direction);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.caller_number?.toLowerCase().includes(q) ||
          c.caller_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [calls, direction, search]);

  const summary = {
    total: calls.length,
    completed: calls.filter((c) => c.status === "completed").length,
    missed: calls.filter((c) => c.status === "missed").length,
    totalMinutes: Math.round(
      calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / 60
    ),
  };

  const agentActive = Boolean(config.enabled);
  const isLoading = loading || dataLoading;

  return (
    <PageShell title="Voice Agent" merchant={merchant} loading={isLoading}>
      <div className="space-y-6">
        {/* Status Card */}
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${
                  agentActive
                    ? "bg-success/10 border-success/30 text-success"
                    : "bg-ink/5 border-rule/30 text-ink-mute"
                }`}
              >
                {agentActive ? <Mic size={22} /> : <MicOff size={22} />}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {agentActive ? "Agent Active" : "Agent Paused"}
                </h2>
                <p className="text-xs text-ink-mute mt-0.5">
                  {agentActive
                    ? "Inbound and outbound calls are being handled automatically."
                    : "Toggle to activate voice agent for incoming calls."}
                </p>
                {config.phone_number && (
                  <p className="text-xs font-mono text-accent mt-1">
                    {config.phone_number}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant={agentActive ? "outline" : "primary"}
              onClick={toggleAgent}
              disabled={busy}
            >
              {agentActive ? <MicOff size={14} /> : <Mic size={14} />}
              {agentActive ? "Pause" : "Activate"}
            </Button>
          </div>
        </Card>

        {/* Summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Calls", value: String(summary.total) },
            { label: "Completed", value: String(summary.completed) },
            { label: "Missed", value: String(summary.missed) },
            { label: "Total Talk Time", value: `${summary.totalMinutes} min` },
          ].map((s) => (
            <div
              key={s.label}
              className="p-4 rounded-2xl bg-paper-deep/20 border border-rule/30"
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                {s.label}
              </div>
              <div className="mt-1.5 text-xl font-semibold nums text-ink">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by number or name..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-paper-deep/30 border border-rule/40 text-sm text-ink placeholder:text-ink-mute/50 focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
            />
          </div>
          <div className="flex items-center rounded-xl border border-rule/40 bg-paper-deep/20 p-1 gap-1">
            {(["all", "inbound", "outbound"] as FilterDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${
                  direction === d
                    ? "bg-accent text-paper shadow-sm"
                    : "text-ink-mute hover:text-ink"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Call Log */}
        <Card className="p-0 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Empty
                title={calls.length === 0 ? "No call history" : "No matching calls"}
                hint={
                  calls.length === 0
                    ? "Activate the voice agent to start receiving and placing calls."
                    : "Try a different filter or search term."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-paper-deep/35 border-b border-rule/50">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-mute font-mono">
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Direction</th>
                    <th className="px-6 py-4">Caller</th>
                    <th className="px-6 py-4">Duration</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/30">
                  {filtered.map((call) => {
                    const Icon = DIRECTION_ICONS[call.direction] ?? PhoneCall;
                    return (
                      <tr
                        key={call.id}
                        className="hover:bg-paper-deep/20 transition-colors duration-200"
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <Clock size={12} className="text-ink-mute" />
                            <span className="text-xs text-ink-soft font-mono">
                              {call.created_at
                                ? format(parseISO(call.created_at), "MMM d, HH:mm")
                                : "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          <div
                            className={`flex items-center gap-1.5 ${DIRECTION_COLORS[call.direction] ?? "text-ink-mute"}`}
                          >
                            <Icon size={14} />
                            <span className="text-[10px] font-mono uppercase tracking-wider">
                              {call.direction}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          <span className="font-mono text-xs text-ink">
                            {call.caller_number}
                          </span>
                          {call.caller_name && (
                            <span className="block text-[10px] text-ink-mute mt-0.5">
                              {call.caller_name}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 font-mono text-xs nums text-ink-soft">
                          {durationLabel(call.duration_seconds ?? 0)}
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge tone={STATUS_TONES[call.status] ?? "default"}>
                            {call.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}