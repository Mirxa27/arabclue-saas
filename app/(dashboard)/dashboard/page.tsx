import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import type { InvoiceSummary, SocialPostSummary } from "@/lib/types/database";
import { AnimatedCounter } from "@/components/dashboard/animated-counter";
import { PulseIndicator } from "@/components/dashboard/pulse-indicator";
import { AgentsPanel } from "@/components/dashboard/agents-panel";
import Link from "next/link";
import {
  ArrowUpRight,
  Sparkles,
  Phone,
  FileText,
  CheckCircle2,
  TrendingUp,
  Receipt,
  CalendarClock,
  Zap,
  BarChart3,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Users,
  Store,
} from "lucide-react";

// ── Helper: slide-in stagger wrapper ──────────────────────────────
function StaggerGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  const colMap: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "lg:grid-cols-4",
  };
  return (
    <section className={`grid grid-cols-2 ${colMap[cols] ?? "lg:grid-cols-4"} 2xl:grid-cols-4 gap-3 sm:gap-4 xl:gap-5 stagger-container`}>
      {children}
    </section>
  );
}

function StaggerCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={`stagger-item flex flex-col justify-between group transition-all duration-300 hover:border-accent/30 hover:shadow-glass-lg ${className ?? ""}`}>
      {children}
    </Card>
  );
}

// ── Metric Card (client wrapper for animation) ────────────────────
function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  accent,
  fill,
}: {
  label: string;
  value: number;
  unit?: string;
  icon: React.ElementType;
  accent: "accent" | "ink" | "success" | "warm";
  fill: number;
}) {
  const accentColor = {
    accent: "text-accent",
    ink: "text-ink",
    success: "text-emerald-500",
    warm: "text-accent-warm",
  }[accent];

  const softBg = {
    accent: "bg-accent/5",
    ink: "bg-ink/5",
    success: "bg-emerald-500/5",
    warm: "bg-accent-warm/5",
  }[accent];

  const fillColor = {
    accent: "bg-accent",
    ink: "bg-ink",
    success: "bg-emerald-500",
    warm: "bg-accent-warm",
  }[accent];

  return (
    <StaggerCard className={softBg}>
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-xl ${softBg} flex items-center justify-center`}>
          <Icon size={17} strokeWidth={2} className={accentColor} />
        </div>
      </div>
      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">{label}</p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <AnimatedCounter
            value={value}
            className={`text-xl md:text-2xl font-semibold nums ${accentColor}`}
          />
          {unit && <span className="text-[10px] font-mono text-ink-mute">{unit}</span>}
        </div>
      </div>
      {/* Fill bar */}
      <div className="mt-4 h-1 w-full bg-rule/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${fillColor} animate-fill-bar`}
          style={
            {
              "--fill-width": `${Math.min(100, Math.max(0, fill))}%`,
            } as React.CSSProperties
          }
        />
      </div>
    </StaggerCard>
  );
}

// ── Quick Action Button ──────────────────────────────────────────
function QuickAction({
  href,
  icon: Icon,
  label,
  color,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center p-3 rounded-xl border border-rule/45 bg-paper/50 hover:bg-paper hover:border-accent/40 active:scale-95 transition-all text-center gap-1.5 select-none touch-target"
    >
      <Icon size={18} className={`mx-auto ${color}`} />
      <span className="text-xs font-sans font-medium text-ink">{label}</span>
    </Link>
  );
}

// ── Plan Feature Check ───────────────────────────────────────────
function PlanCheck({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-ink-soft">
      <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
      {label}
    </li>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const merchant = await getCurrentMerchant();
  const supabase = await getServerSupabase();

  const [invoicesResp, postsResp, clearedResp] = await Promise.all([
    merchant
      ? supabase
          .from("invoices")
          .select("id, invoice_number, total, status, created_at")
          .eq("merchant_id", merchant.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as InvoiceSummary[] }),
    merchant
      ? supabase
          .from("social_posts")
          .select("id, hook, platforms, scheduled_for, status")
          .eq("merchant_id", merchant.id)
          .eq("status", "scheduled")
          .order("scheduled_for", { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] as SocialPostSummary[] }),
    merchant
      ? supabase
          .from("invoices")
          .select("id")
          .eq("merchant_id", merchant.id)
          .eq("status", "cleared")
      : Promise.resolve({ data: [] }),
  ]);

  const invoices = (invoicesResp.data ?? []) as InvoiceSummary[];
  const upcoming = (postsResp.data ?? []) as SocialPostSummary[];
  const clearedCount = (clearedResp.data ?? []).length;
  const mtdTotal = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0);

  const healthScore =
    invoices.length > 0
      ? Math.min(100, Math.round((clearedCount / Math.max(invoices.length, 1)) * 100))
      : 100;

  const healthLabel =
    healthScore >= 90 ? "Excellent" : healthScore >= 70 ? "Good" : "Needs attention";

  return (
    <PageShell title="Overview" merchant={merchant}>
      <div className="space-y-6 md:space-y-8">
        {/* KPI row */}
        <StaggerGrid cols={4}>
          <MetricCard
            label="MTD Invoiced"
            value={mtdTotal}
            unit="SAR"
            icon={Receipt}
            accent="accent"
            fill={65}
          />
          <MetricCard
            label="Invoices"
            value={invoices.length}
            icon={FileText}
            accent="ink"
            fill={Math.min(100, invoices.length * 20)}
          />
          <MetricCard
            label="Cleared"
            value={clearedCount}
            icon={CheckCircle2}
            accent="success"
            fill={invoices.length > 0 ? Math.round((clearedCount / Math.max(invoices.length, 1)) * 100) : 0}
          />
          <MetricCard
            label="Scheduled"
            value={upcoming.length}
            icon={CalendarClock}
            accent="warm"
            fill={Math.min(100, upcoming.length * 20)}
          />
        </StaggerGrid>

        {/* System health indicator */}
        <Card className="border-accent/15 bg-accent/[0.015] backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <PulseIndicator status={healthScore >= 90 ? "healthy" : healthScore >= 70 ? "degraded" : "critical"} />
            <div>
              <span className="text-sm font-semibold text-ink">System Health</span>
              <span className="text-xs text-ink-mute ml-2 font-mono">{healthScore}%</span>
            </div>
            <span
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                healthScore >= 90
                  ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5"
                  : healthScore >= 70
                  ? "text-amber-500 border-amber-500/30 bg-amber-500/5"
                  : "text-red-500 border-red-500/30 bg-red-500/5"
              }`}
            >
              {healthLabel}
            </span>
          </div>
          <div className="flex gap-3 text-[11px] text-ink-mute">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> ZATCA On
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-accent" /> AI Agents Active
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-accent-warm" /> Salla Synced
            </span>
          </div>
        </Card>

        {/* Expanded Grid: 2 cols main + 1 sidebar on lg, stacked on mobile */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 2xl:gap-8 stagger-container">
          {/* ── Main Column ───────────────────────────────────────── */}
          <section className="xl:col-span-3 space-y-6 2xl:space-y-8 stagger-item">
            {/* Recent Invoices */}
            <Card className="h-full flex flex-col">
              <CardHeader className="flex-row items-center justify-between pb-4 border-b border-rule/30 mb-6">
                <div>
                  <CardTitle className="text-xl md:text-2xl flex items-center gap-2">
                    <Receipt size={20} className="text-accent" />
                    Recent ZATCA Invoices
                  </CardTitle>
                  <CardSubtitle className="mt-1 text-xs md:text-sm">
                    Latest compliance receipts synced from Salla
                  </CardSubtitle>
                </div>
                <Link
                  href="/invoices"
                  className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider font-semibold text-accent hover:text-accent-deep hover:underline transition-colors"
                >
                  View all <ArrowUpRight size={14} />
                </Link>
              </CardHeader>

              {invoices.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-16">
                  <Empty
                    title="No invoices yet"
                    hint="Connect your Salla store and orders will auto-generate ZATCA-compliant invoices."
                    action={
                      <Link href="/integrations">
                        <Button size="sm" variant="primary">
                          <Sparkles size={14} />
                          Connect Salla
                        </Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-widest text-ink-mute border-b border-rule/55">
                        <th className="py-3 font-mono">Invoice #</th>
                        <th className="py-3 font-mono">Date</th>
                        <th className="py-3 font-mono">Status</th>
                        <th className="py-3 font-mono text-end">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule/30">
                      {invoices.map((inv) => (
                        <tr
                          key={inv.id}
                          className="hover:bg-paper-deep/20 transition-colors duration-200 cursor-pointer"
                        >
                          <td className="py-3.5 font-mono text-xs font-semibold text-ink">
                            {inv.invoice_number}
                          </td>
                          <td className="py-3.5 text-xs text-ink-soft">
                            {new Date(inv.created_at).toLocaleDateString("en-GB")}
                          </td>
                          <td className="py-3.5">
                            <Badge
                              tone={
                                inv.status === "cleared"
                                  ? "success"
                                  : inv.status === "failed"
                                  ? "danger"
                                  : "default"
                              }
                            >
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="py-3.5 text-end nums font-semibold">
                            {Number(inv.total).toFixed(2)}{" "}
                            <span className="text-[10px] font-mono font-normal text-ink-mute">SAR</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Performance Snapshot */}
            <Card>
              <CardHeader className="pb-4 border-b border-rule/30 mb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 size={16} className="text-accent" />
                  Performance Snapshot
                </CardTitle>
                <CardSubtitle className="text-xs">30-day activity across modules</CardSubtitle>
              </CardHeader>
              <div className="grid grid-cols-3 gap-4 text-center stagger-container">
                {[
                  { label: "Invoices", value: invoices.length, icon: Receipt },
                  { label: "AI Posts", value: upcoming.length, icon: Sparkles },
                  { label: "Agents", value: 3, icon: Users },
                ].map((stat) => {
                  const SIcon = stat.icon;
                  return (
                    <div
                      key={stat.label}
                      className="stagger-item p-4 rounded-xl bg-paper-deep/20 border border-rule/30 hover:border-accent/30 transition-all duration-300 hover:shadow-glass-sm"
                    >
                      <SIcon size={18} strokeWidth={1.5} className="mx-auto mb-2 text-ink-mute" />
                      <div className="text-lg font-semibold nums text-ink">{stat.value}</div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-mute mt-0.5">
                        {stat.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* ── Sidebar Column ────────────────────────────────────── */}
          <section className="xl:col-span-2 space-y-6 2xl:space-y-8 stagger-item">
            {/* Quick Actions */}
            <Card className="bg-accent/[0.02] border-accent/20">
              <CardHeader className="pb-3 mb-4 border-b border-accent/10">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap size={16} className="text-accent-warm" />
                  Quick Actions
                </CardTitle>
                <CardSubtitle className="text-xs">AI agents at your service</CardSubtitle>
              </CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <QuickAction href="/social" icon={Sparkles} label="New Post" color="text-accent-warm" />
                <QuickAction href="/voice" icon={Phone} label="Voice Agent" color="text-accent" />
                <QuickAction href="/brand" icon={TrendingUp} label="Brand Kit" color="text-accent" />
                <QuickAction href="/integrations" icon={RefreshCw} label="Connect" color="text-accent-warm" />
              </div>
            </Card>

            {/* AI Agents — persona-rich cards with toggle */}
            <Card>
              <CardHeader className="flex-row items-center justify-between pb-3 mb-4 border-b border-rule/30">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users size={16} className="text-accent" />
                    فريقك الذكي
                  </CardTitle>
                  <CardSubtitle className="text-xs">AI employees ready to work</CardSubtitle>
                </div>
                <Link
                  href="/settings"
                  className="text-xs font-mono uppercase tracking-wider font-semibold text-accent hover:underline"
                >
                  Configure
                </Link>
              </CardHeader>
              <AgentsPanel />
            </Card>

            {/* Plan Card */}
            <Card>
              <CardHeader className="pb-3 mb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap size={16} className="text-accent" />
                  {merchant?.plan ?? "Lite"}
                </CardTitle>
                <CardSubtitle className="text-xs">Current subscription</CardSubtitle>
              </CardHeader>
              <ul className="space-y-2">
                <PlanCheck label="ZATCA compliance" />
                <PlanCheck label="AI social planner" />
                <PlanCheck label="Voice agent (5 calls/mo)" />
              </ul>
              <Link
                href="/billing"
                className="mt-4 group flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-accent/30 text-xs font-semibold text-accent hover:bg-accent/5 transition-all active:scale-[0.98]"
              >
                Upgrade plan <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </Card>

            {/* Upcoming Posts */}
            <Card className="flex flex-col">
              <CardHeader className="flex-row items-center justify-between pb-3 mb-4 border-b border-rule/30">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CalendarClock size={16} className="text-accent-warm" />
                    Upcoming Posts
                  </CardTitle>
                  <CardSubtitle className="text-xs">Planner agent queue</CardSubtitle>
                </div>
                <Link
                  href="/social"
                  className="text-xs font-mono uppercase tracking-wider font-semibold text-accent hover:underline flex items-center gap-1"
                >
                  Calendar <ArrowUpRight size={14} />
                </Link>
              </CardHeader>
              {upcoming.length === 0 ? (
                <div className="py-8 text-center">
                  <Empty
                    title="No posts scheduled"
                    hint="Set up your brand kit and generate a 30-day content grid in seconds."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-rule/30">
                  {upcoming.map((p) => (
                    <li
                      key={p.id}
                      className="py-3 flex items-baseline justify-between gap-4 first:pt-0 last:pb-0 hover:bg-paper-deep/20 transition-colors rounded-md px-1"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs md:text-sm font-sans font-medium truncate text-ink">{p.hook}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(p.platforms ?? []).map((plat) => (
                            <span
                              key={plat}
                              className="text-[9px] font-mono uppercase tracking-wide bg-paper-deep/50 px-1.5 py-0.5 rounded text-ink-mute"
                            >
                              {plat}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="text-[10px] text-ink-mute font-mono whitespace-nowrap bg-paper-deep/30 px-2 py-1 rounded-lg border border-rule/20">
                        {new Date(p.scheduled_for).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </PageShell>
  );
}