"use client";

/**
 * The dashboard overview (UI-010 / UI-011 / UI-027 / UI-028 / UI-029), rendered from the data
 * app/(dashboard)/dashboard/page.tsx loads on the server (lib/dashboard/overview.ts). A client
 * component because the shared UI primitives (components/ui/primitives.tsx) create a React
 * context at module scope, which Server Components cannot evaluate.
 */
import Link from "next/link";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/dashboard/animated-counter";
import { PulseIndicator } from "@/components/dashboard/pulse-indicator";
import { AgentsPanel } from "@/components/dashboard/agents-panel";
import type { HealthTone, OverviewData } from "@/lib/dashboard/overview";
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
  Users,
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
  labelAr,
  value,
  unit,
  icon: Icon,
  accent,
  fill,
  hint,
}: {
  label: string;
  labelAr: string;
  value: number;
  unit?: string;
  icon: React.ElementType;
  accent: "accent" | "ink" | "success" | "warm";
  /** A real ratio (0–100) to draw, or undefined for no bar. */
  fill?: number;
  hint?: string;
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
        <p className="font-arabic text-[11px] text-ink-soft" dir="rtl">{labelAr}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">{label}</p>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <AnimatedCounter
            value={value}
            className={`text-xl md:text-2xl font-semibold nums ${accentColor}`}
          />
          {unit && <span className="text-[10px] font-mono text-ink-mute">{unit}</span>}
        </div>
        {hint && <p className="mt-1 text-[10px] text-ink-mute">{hint}</p>}
      </div>
      {fill !== undefined && (
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
      )}
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
function PlanCheck({ ar, en }: { ar: string; en: string }) {
  return (
    <li className="flex items-start gap-2 text-xs text-ink-soft">
      <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
      <span>
        <span className="font-arabic block" dir="rtl">{ar}</span>
        <span className="text-ink-mute">{en}</span>
      </span>
    </li>
  );
}

const TONE_DOT: Record<HealthTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-ink-mute/50",
};

// Keyed by string: ZATCA Phase 2 adds "reported" (an accepted simplified invoice).
const INVOICE_STATUS: Record<string, { ar: string; en: string; tone: "success" | "danger" | "default" }> = {
  generated: { ar: "مُنشأة", en: "generated", tone: "default" },
  submitted: { ar: "مُرسلة", en: "submitted", tone: "default" },
  reported: { ar: "مُبلَّغ عنها", en: "reported", tone: "success" },
  cleared: { ar: "معتمدة", en: "cleared", tone: "success" },
  rejected: { ar: "مرفوضة", en: "rejected", tone: "danger" },
  failed: { ar: "فشلت", en: "failed", tone: "danger" },
};

export function OverviewView({ overview }: { overview: OverviewData }) {
  const { stats, recentInvoices: invoices, upcomingPosts: upcoming, checks, clearance, plan } = overview;
  const clearedFill =
    stats.submitted_30d > 0 ? Math.round((Math.min(stats.accepted_30d, stats.submitted_30d) / stats.submitted_30d) * 100) : undefined;
  const pulse = clearance.status === "none" ? "inactive" : clearance.status;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* KPI row */}
      <StaggerGrid cols={4}>
        <MetricCard
          label="Invoiced this month"
          labelAr="المفوتر هذا الشهر"
          value={stats.mtd_total}
          unit="SAR"
          icon={Receipt}
          accent="accent"
          hint={`${stats.mtd_count} invoices · excl. rejected`}
        />
        <MetricCard
          label="Invoices · all time"
          labelAr="كل الفواتير"
          value={stats.invoices_total}
          icon={FileText}
          accent="ink"
        />
        <MetricCard
          label="Accepted by ZATCA · 30 days"
          labelAr="المقبولة من زاتكا خلال ٣٠ يوماً"
          value={stats.accepted_30d}
          icon={CheckCircle2}
          accent="success"
          fill={clearedFill}
          hint={stats.submitted_30d > 0 ? `of ${stats.submitted_30d} submitted to ZATCA` : "nothing submitted yet"}
        />
        <MetricCard
          label="Scheduled posts"
          labelAr="منشورات مجدولة"
          value={stats.posts_scheduled}
          icon={CalendarClock}
          accent="warm"
        />
      </StaggerGrid>

      {/* System health indicator */}
      <Card className="border-accent/15 bg-accent/[0.015] backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <PulseIndicator status={pulse} />
          <div>
            <span className="text-sm font-semibold text-ink">
              <span className="font-arabic" dir="rtl">حالة النظام</span> · System Health
            </span>
            <span className="text-xs text-ink-mute ml-2 font-mono">
              {clearance.rate === null ? "—" : `${clearance.rate}%`} ZATCA acceptance · 30d
            </span>
          </div>
          <span
            className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${
              clearance.status === "healthy"
                ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5"
                : clearance.status === "degraded"
                ? "text-amber-500 border-amber-500/30 bg-amber-500/5"
                : clearance.status === "critical"
                ? "text-red-500 border-red-500/30 bg-red-500/5"
                : "text-ink-mute border-rule/50 bg-paper-deep/20"
            }`}
          >
            {clearance.label.en} · <span className="font-arabic normal-case">{clearance.label.ar}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-ink-mute">
          {checks.map((check) => {
            const content = (
              <>
                <span className={`w-2 h-2 rounded-full ${TONE_DOT[check.tone]}`} />
                <span>{check.label.en}</span>
                <span className="font-arabic" dir="rtl">· {check.label.ar}</span>
              </>
            );
            return check.href ? (
              <Link key={check.key} href={check.href} className="flex items-center gap-1 hover:text-accent hover:underline">
                {content}
              </Link>
            ) : (
              <span key={check.key} className="flex items-center gap-1">
                {content}
              </span>
            );
          })}
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
                  <span className="font-arabic" dir="rtl">أحدث فواتيرك</span> · Latest invoices generated from your orders
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
                  title="No invoices yet · لا توجد فواتير بعد"
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
                      <tr key={inv.id} className="hover:bg-paper-deep/20 transition-colors duration-200">
                        <td className="py-3.5 font-mono text-xs font-semibold text-ink">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="hover:text-accent underline-offset-2 hover:underline"
                          >
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="py-3.5 text-xs text-ink-soft">
                          {new Date(inv.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}
                        </td>
                        <td className="py-3.5">
                          <Badge
                            tone={INVOICE_STATUS[inv.status]?.tone ?? "default"}
                          >
                            {INVOICE_STATUS[inv.status]?.en ?? inv.status}
                          </Badge>
                        </td>
                        <td className="py-3.5 text-end nums font-semibold">
                          {Number(inv.total ?? 0).toFixed(2)}{" "}
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
              <CardSubtitle className="text-xs">
                <span className="font-arabic" dir="rtl">نشاط آخر ٣٠ يوماً</span> · Last 30 days across modules
              </CardSubtitle>
            </CardHeader>
            <div className="grid grid-cols-3 gap-4 text-center stagger-container">
              {[
                { label: "Invoices", ar: "فواتير", value: stats.invoices_30d, icon: Receipt },
                { label: "Posts published", ar: "منشورات نُشرت", value: stats.posts_published_30d, icon: Sparkles },
                { label: "Voice bookings", ar: "حجوزات صوتية", value: stats.bookings_30d, icon: Phone },
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
                    <p className="font-arabic text-[10px] text-ink-mute" dir="rtl">{stat.ar}</p>
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
                href={overview.agentsHref}
                className="text-xs font-mono uppercase tracking-wider font-semibold text-accent hover:underline"
              >
                {overview.agentsHref === "/employees" ? "Manage" : "Hire"}
              </Link>
            </CardHeader>
            <AgentsPanel />
          </Card>

          {/* Plan Card */}
          <Card>
            <CardHeader className="pb-3 mb-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap size={16} className="text-accent" />
                  {plan.name}
                </CardTitle>
                <CardSubtitle className="text-xs">
                  <span className="font-arabic" dir="rtl">اشتراكك الحالي</span> · Current subscription
                </CardSubtitle>
              </div>
              <Badge tone={plan.statusTone}>
                {plan.statusLabel.en} · <span className="font-arabic normal-case">{plan.statusLabel.ar}</span>
              </Badge>
            </CardHeader>
            <ul className="space-y-2">
              {plan.features.map((f) => (
                <PlanCheck key={f.en} ar={f.ar} en={f.en} />
              ))}
            </ul>
            <Link
              href="/billing"
              className="mt-4 group flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-accent/30 text-xs font-semibold text-accent hover:bg-accent/5 transition-all active:scale-[0.98]"
            >
              {plan.status === "past_due" || plan.status === "pending"
                ? "Complete payment · أكمل الدفع"
                : plan.canUpgrade
                ? "Upgrade plan · ترقية الباقة"
                : "Manage billing · إدارة الاشتراك"}{" "}
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
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
                  title="No posts scheduled · لا توجد منشورات مجدولة"
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
                      <p className="text-xs md:text-sm font-sans font-medium truncate text-ink" dir="auto">{p.hook}</p>
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
                        timeZone: "Asia/Riyadh",
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
  );
}
