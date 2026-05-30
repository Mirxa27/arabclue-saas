"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useMerchant } from "@/hooks/use-merchant";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getRole, formatPriceSAR } from "@/lib/employees/catalog";
import type { AIEmployeeRow } from "@/lib/employees/types";
import { useToast } from "@/components/ui/toast";
import {
  Users,
  Sparkles,
  ArrowUpRight,
  Pause,
  Play,
  MessageCircle,
  Clock
} from "lucide-react";

export function TeamListClient() {
  const { merchant } = useMerchant();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<AIEmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ employees: AIEmployeeRow[] }>("/api/employees");
      setEmployees(res.employees.filter((e) => e.status !== "offboarded"));
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Failed to load team", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePause(emp: AIEmployeeRow) {
    const next = emp.status === "paused" ? "active" : "paused";
    try {
      await apiFetch(`/api/employees/${emp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next })
      });
      setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: next } : e)));
      toast(next === "paused" ? "Employee paused" : "Employee resumed", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Update failed", "error");
    }
  }

  return (
    <PageShell title="My Team" merchant={merchant}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl md:text-3xl text-ink flex items-center gap-2">
              <Users size={22} className="text-accent" />
              My AI team
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Hired employees work 24/7 across WhatsApp, Telegram, Slack, and email.
            </p>
          </div>
          <Link href="/marketplace">
            <Button variant="primary" size="sm">
              <Sparkles size={14} className="mr-1.5" />
              Hire more
            </Button>
          </Link>
        </div>

        {loading ? (
          <Card>
            <p className="text-sm text-ink-mute py-8 text-center">Loading team…</p>
          </Card>
        ) : employees.length === 0 ? (
          <Card>
            <div className="py-12 text-center">
              <Empty
                title="No AI employees yet"
                hint="Browse the marketplace and start a 7-day trial — no card required."
              />
              <Link href="/marketplace" className="inline-block mt-6">
                <Button variant="primary">Browse marketplace</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {employees.map((emp) => {
              const role = getRole(emp.role_id);
              const trialActive =
                emp.billing_status === "trial" &&
                emp.trial_ends_at &&
                new Date(emp.trial_ends_at) > new Date();
              return (
                <Card
                  key={emp.id}
                  className="flex flex-col h-full hover:border-accent/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{emp.avatar ?? role?.emoji ?? "🤖"}</span>
                      <div>
                        <h3 className="font-display text-lg text-ink">{emp.display_name}</h3>
                        <p className="text-xs text-ink-mute">{role?.name ?? emp.role_id}</p>
                      </div>
                    </div>
                    <Badge
                      tone={
                        emp.status === "paused"
                          ? "warn"
                          : trialActive
                            ? "accent"
                            : emp.billing_status === "active"
                              ? "success"
                              : "default"
                      }
                    >
                      {emp.status === "paused"
                        ? "Paused"
                        : trialActive
                          ? "Trial"
                          : emp.billing_status}
                    </Badge>
                  </div>

                  <p className="mt-3 text-sm text-ink-soft line-clamp-2">
                    {role?.tagline ?? "AI teammate"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-mono text-ink-mute">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-deep/40 border border-rule/30">
                      <MessageCircle size={10} /> chat
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-deep/40 border border-rule/30">
                      {formatPriceSAR(emp.monthly_charge_halalas)} SAR/mo
                    </span>
                    {trialActive && emp.trial_ends_at && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent-warm/10 text-accent-warm border border-accent-warm/20">
                        <Clock size={10} />
                        trial until {new Date(emp.trial_ends_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto pt-4 flex items-center gap-2 border-t border-rule/30">
                    <Link href={`/employees/${emp.id}`} className="flex-1">
                      <Button variant="primary" size="sm" className="w-full">
                        Open workspace
                        <ArrowUpRight size={12} className="ml-1" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => togglePause(emp)}
                      aria-label={emp.status === "paused" ? "Resume" : "Pause"}
                    >
                      {emp.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
