/**
 * arabclue — Agents Panel
 *
 * Displays AI employee persona cards with toggle, status, and persona details.
 * Used on the main dashboard and onboarding flow.
 */
"use client";

import { memo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import type { PersonaRole } from "@/lib/agents/personas";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Constants ───────────────────────────────────────────────────────────────

const ROLE_ICONS: Record<PersonaRole, string> = {
  social: "📱",
  voice: "📞",
  seo: "🔍",
  sales: "💼",
  support: "🛟",
  analyst: "📊",
  onboarding: "✨",
};

const ROLE_LABELS: Record<PersonaRole, string> = {
  social: "المسوق الاجتماعي",
  voice: "الرد الآلي الصوتي",
  seo: "خبير السيو",
  sales: "مندوب المبيعات",
  support: "دعم العملاء",
  analyst: "محلل البيانات",
  onboarding: "مساعدة التهيئة",
};

const ROLE_ROUTES: Record<PersonaRole, string> = {
  social: "/social",
  voice: "/voice",
  seo: "/seo",
  sales: "/dashboard",
  support: "/dashboard",
  analyst: "/dashboard",
  onboarding: "/welcome",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500",
  idle: "bg-ink/30",
  paused: "bg-amber-500",
  error: "bg-red-500",
  configuring: "bg-accent",
};

const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  active: { en: "Active", ar: "نشط" },
  idle: { en: "Inactive", ar: "غير نشط" },
  paused: { en: "Paused", ar: "متوقف" },
  error: { en: "Error", ar: "خطأ" },
  configuring: { en: "Setting up", ar: "جاري الإعداد" },
};

// ── Sub-components ──────────────────────────────────────────────────────────

const AgentCard = memo(function AgentCard({
  role,
  enabled,
  status,
  persona,
  lastError,
  onToggle,
}: {
  role: PersonaRole;
  enabled: boolean;
  status: string;
  persona: {
    name: string;
    age: number;
    role: string;
    avatar: string;
    tone: string;
    expertise: string[];
    traits: string[];
    backstory: string;
  };
  lastError: string | null;
  onToggle: () => void;
}) {
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
  const statusLabel = STATUS_LABELS[status] ?? STATUS_LABELS.idle;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-ink/10",
        "bg-paper/80 backdrop-blur-md p-5 shadow-sm transition-all duration-300",
        "hover:border-ink/15 hover:shadow-md",
        enabled && "ring-1 ring-emerald-500/25",
      )}
    >
      <div className="absolute end-4 top-4 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", statusColor, status === "active" && "animate-pulse")} />
        <span className="text-[11px] text-ink/50 font-arabic tracking-wide">
          {statusLabel.en}
        </span>
      </div>

      <div className="mb-4 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-ink/10 bg-accent/10 text-2xl">
          {ROLE_ICONS[role]}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-ink">
            {persona.name}
          </h3>
          <p className="mt-0.5 font-arabic text-[12px] text-ink/55">
            {ROLE_LABELS[role]} · {persona.age} سنة
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {persona.traits.slice(0, 3).map((trait) => (
          <span
            key={trait}
            className="rounded-full border border-ink/8 bg-ink/[0.04] px-2 py-0.5 font-arabic text-[11px] text-ink/60"
          >
            {trait}
          </span>
        ))}
      </div>

      <p className="mb-4 line-clamp-2 font-arabic text-[12px] leading-relaxed text-ink/45">
        {persona.backstory}
      </p>

      {lastError && (
        <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 p-2">
          <p className="truncate font-arabic text-[11px] text-red-600 dark:text-red-400">
            {lastError}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={status === "configuring"}
          className={cn(
            "flex-1 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200",
            "disabled:cursor-not-allowed disabled:opacity-40",
            enabled
              ? "border border-ink/12 bg-ink/[0.06] text-ink/75 hover:bg-ink/[0.1] hover:text-ink"
              : "border border-accent/20 bg-accent/15 text-accent hover:bg-accent/25",
          )}
        >
          {enabled ? "إيقاف" : "تشغيل"}
        </button>
        <Link
          href={ROLE_ROUTES[role]}
          className="rounded-xl border border-ink/10 bg-ink/[0.04] p-2 text-ink/45 transition-all duration-200 hover:bg-ink/[0.08] hover:text-ink/75"
          aria-label={`Open ${persona.name}`}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
        </Link>
      </div>
    </div>
  );
});

const AgentCardSkeleton = memo(function AgentCardSkeleton() {
  return (
    <div className="rounded-2xl border border-ink/10 bg-paper/60 p-5">
      <div className="mb-4 flex items-start gap-4">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="mb-4 flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <Skeleton className="mb-1 h-3 w-full" />
      <Skeleton className="mb-4 h-3 w-3/4" />
      <Skeleton className="h-9 w-full rounded-xl" />
    </div>
  );
});

const EmptyState = memo(function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center px-4 py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-ink/10 bg-ink/[0.04] text-3xl">
        🤖
      </div>
      <h3 className="mb-1 font-arabic text-[15px] font-semibold text-ink/70">
        لا يوجد موظفين افتراضيين بعد
      </h3>
      <p className="max-w-xs text-center font-arabic text-[13px] text-ink/45">
        شغّل مساعديك الافتراضيين من صفحة الإعدادات وابدأ بأتمتة أعمالك
      </p>
    </div>
  );
});

export const AgentsPanel = memo(function AgentsPanel() {
  const { agents, loading, toggleAgent } = useAgents();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <AgentCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const coreAgents = agents.filter((a) => ["social", "voice", "seo"].includes(a.role));

  if (coreAgents.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {coreAgents.map((agent) => (
        <AgentCard
          key={agent.role}
          role={agent.role}
          enabled={agent.enabled}
          status={agent.status}
          persona={agent.persona}
          lastError={agent.lastError}
          onToggle={() => toggleAgent(agent.role)}
        />
      ))}
    </div>
  );
});
