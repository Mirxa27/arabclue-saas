"use client";

import { useEffect, useState, useMemo } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { PageIntro } from "@/components/dashboard/page-intro";
import {
  Badge,
  Card,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Empty,
} from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { useMerchant } from "@/hooks/use-merchant";
import { SocialPostDrawer } from "@/components/dashboard/social-post-drawer";
import type { SocialPostSummary } from "@/lib/types/database";
import {
  Sparkles,
  CalendarDays,
  CalendarClock,
  ListFilter,
  BarChart3,
} from "lucide-react";
import { format, parseISO, isSameDay, addDays, startOfDay, isToday } from "date-fns";

type ViewMode = "list" | "week";
type FilterStatus = "all" | "scheduled" | "published" | "failed";

export default function SocialPage() {
  const { merchant, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [posts, setPosts] = useState<SocialPostSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [postsLoading, setPostsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setPostsLoading(false);
      return;
    }
    (async () => {
      setPostsLoading(true);
      try {
        const sb = getBrowserSupabase();
        const { data, error } = await sb
          .from("social_posts")
          .select("id, scheduled_for, platforms, hook, goal, status")
          .eq("merchant_id", merchant.id)
          .order("scheduled_for", { ascending: true })
          .limit(90);
        if (error) throw error;
        setPosts((data ?? []) as SocialPostSummary[]);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load posts", "error");
      } finally {
        setPostsLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function generate() {
    setGenerating(true);
    try {
      await apiFetch("/api/social/plan", {
        method: "POST",
        body: JSON.stringify({ horizonDays: 30, postsPerWeek: 5 }),
      });
      toast("30-day social plan generated", "success");
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Generation failed", "error");
    } finally {
      setGenerating(false);
    }
  }

  function handleUpdated(patch: Partial<SocialPostSummary> & { id: string }) {
    setPosts((prev) =>
      prev.map((p) => (p.id === patch.id ? { ...p, ...patch } : p))
    );
  }

  function handleDeleted(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? posts
        : posts.filter((p) => p.status === statusFilter),
    [posts, statusFilter]
  );

  /* ----- Week view helpers ----- */
  const today = startOfDay(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPostSummary[]>();
    filtered.forEach((p) => {
      const key = format(parseISO(p.scheduled_for), "yyyy-MM-dd");
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    });
    return map;
  }, [filtered]);

  const summary = {
    total: posts.length,
    scheduled: posts.filter((p) => p.status === "scheduled").length,
    published: posts.filter((p) => p.status === "published").length,
    thisWeek: posts.filter(
      (p) =>
        parseISO(p.scheduled_for) >= today &&
        parseISO(p.scheduled_for) < addDays(today, 7)
    ).length,
  };

  const STAT_TONES: Record<string, "success" | "danger" | "warn" | "default"> =
    {
      scheduled: "warn",
      published: "success",
      failed: "danger",
      generating: "default",
      publishing: "default",
      canceled: "default",
    };

  const statCards = [
    { label: "Total posts", icon: BarChart3, value: summary.total },
    { label: "This week", icon: CalendarClock, value: summary.thisWeek },
    { label: "Scheduled", icon: CalendarDays, value: summary.scheduled },
    { label: "Live", icon: Sparkles, value: summary.published },
  ] as const;

  return (
    <PageShell title="Social Calendar" merchant={merchant}>
      {postsLoading ? (
        <div className="p-8 text-sm text-ink-mute text-center">Loading calendar…</div>
      ) : (
        <div className="space-y-6">
          <PageIntro
            kicker="Agentic social"
            title="Content calendar"
            description="Plan, review, and publish posts across your connected channels. Generate a 30-day grid from your brand kit, then edit hooks and captions before they go live."
            descriptionAr="خطّط وراجع وجدول المنشورات على قنواتك. أنشئ شبكة ٣٠ يوماً من هوية متجرك ثم عدّل النصوص قبل النشر."
            actions={
              <Button onClick={generate} disabled={generating} size="sm">
                <Sparkles size={14} />
                {generating ? "Generating…" : "Generate 30-day grid"}
              </Button>
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {statCards.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="dashboard-stat-card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="marker-numeral">{s.label}</p>
                    <span className="landing-icon-wrap !h-8 !w-8">
                      <Icon size={14} strokeWidth={2} aria-hidden />
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold nums text-ink">{s.value}</p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="dashboard-segment" role="group" aria-label="Filter by status">
              {(["all", "scheduled", "published", "failed"] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  data-active={statusFilter === f}
                  className="dashboard-segment-btn"
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[1rem]" />
            <div className="dashboard-segment" role="group" aria-label="Calendar view">
              {(["list", "week"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  data-active={view === v}
                  data-tone={view === v ? "ink" : undefined}
                  className="dashboard-segment-btn"
                >
                  {v === "list" ? <ListFilter size={12} aria-hidden /> : <CalendarDays size={12} aria-hidden />}
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {filtered.length === 0 ? (
            <Card className="p-12 text-center">
              <Empty
                title={posts.length === 0 ? "Calendar empty" : "No matching posts"}
                hint={
                  posts.length === 0
                    ? "Generate a 30-day grid from your brand kit to populate the queue."
                    : "Try a different status filter."
                }
                action={
                  posts.length === 0 ? (
                    <Button onClick={generate} disabled={generating}>
                      <Sparkles size={14} /> Generate plan
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : view === "list" ? (
            /* ---- List View ---- */
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-rule/30">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className="w-full py-4 px-6 flex items-start gap-5 text-left hover:bg-paper-deep/25 transition-colors duration-200"
                    >
                      {/* Date badge */}
                      <div className="w-20 shrink-0 text-center">
                        <div className="font-semibold nums text-2xl leading-tight text-ink">
                          {format(parseISO(p.scheduled_for), "d")}
                        </div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-mute font-mono">
                          {format(parseISO(p.scheduled_for), "MMM")}
                        </div>
                        <div className="text-[10px] text-ink-mute font-mono mt-1.5">
                          {format(parseISO(p.scheduled_for), "HH:mm")}
                        </div>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm md:text-base leading-snug font-medium text-ink">
                          {p.hook}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {(p.platforms ?? []).map((pl) => (
                            <span
                              key={pl}
                              className="text-[9px] font-mono uppercase tracking-wide bg-paper-deep/50 px-1.5 py-0.5 rounded text-ink-mute"
                            >
                              {pl}
                            </span>
                          ))}
                          {p.goal && (
                            <Badge tone="success" className="text-[9px]">
                              {p.goal}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Status */}
                      <Badge tone={STAT_TONES[p.status] ?? "default"} className="shrink-0">
                        {p.status}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            /* ---- Week View ---- */
            <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
              {weekDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const dayPosts = postsByDay.get(key) ?? [];
                return (
                  <Card
                    key={key}
                    className={`min-h-[180px] flex flex-col ${
                      isToday(day)
                        ? "border-accent/40 ring-1 ring-accent/20 bg-accent/[0.03]"
                        : ""
                    }`}
                  >
                    <div className="px-3 pt-3 pb-2 border-b border-rule/20">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                        {format(day, "EEE")}
                      </div>
                      <div className={`text-lg font-semibold nums ${isToday(day) ? "text-accent" : "text-ink"}`}>
                        {format(day, "d")}
                      </div>
                    </div>
                    <div className="flex-1 px-2 py-2 space-y-1.5 overflow-y-auto max-h-48">
                      {dayPosts.length === 0 ? (
                        <div className="text-[10px] text-ink-mute text-center mt-6 font-mono">
                          —
                        </div>
                      ) : (
                        dayPosts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedId(p.id)}
                            className="block w-full text-left p-2 rounded-lg border border-rule/20 bg-paper-deep/30 hover:border-accent/40 hover:bg-paper transition-all duration-200"
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[9px] font-mono text-ink-mute">
                                {format(parseISO(p.scheduled_for), "HH:mm")}
                              </span>
                              <Badge tone={STAT_TONES[p.status] ?? "default"} className="text-[8px] px-1 py-0">
                                {p.status}
                              </Badge>
                            </div>
                            <p className="text-xs leading-snug text-ink line-clamp-2">
                              {p.hook}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <SocialPostDrawer
        postId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </PageShell>
  );
}