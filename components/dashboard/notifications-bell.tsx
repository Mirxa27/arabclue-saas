"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { NotificationFeed, NotificationItem } from "@/lib/notifications/feed";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; feed: NotificationFeed }
  | { status: "no_merchant" }
  | { status: "error"; message: string };

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh"
  }).format(new Date(t));
}

/**
 * Topbar bell (UI-016): the merchant's real notifications from GET /api/notifications. The dot
 * shows only while something is unread; opening the panel marks the listed items as read.
 */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const feed = await apiFetch<NotificationFeed>("/api/notifications");
      setState({ status: "ready", feed });
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        setState({ status: "no_merchant" });
      } else {
        setState({ status: "error", message: err instanceof ApiClientError ? err.message : "Could not load notifications" });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const feed = state.status === "ready" ? state.feed : null;
  const unread = feed?.unread_count ?? 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    if (!feed) {
      void load();
      return;
    }
    if (unread === 0) return;
    const newestMs = feed.items.reduce((max, item) => Math.max(max, Date.parse(item.at) || 0), 0);
    const newest = newestMs > 0 ? new Date(newestMs).toISOString() : null;
    try {
      const res = await apiFetch<{ last_seen_at: string | null }>("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify(newest ? { up_to: newest } : {})
      });
      const seen = res.last_seen_at ? new Date(res.last_seen_at).getTime() : Date.now();
      setState({
        status: "ready",
        feed: {
          items: feed.items.map((i) => ({ ...i, unread: new Date(i.at).getTime() > seen })),
          unread_count: feed.items.filter((i) => new Date(i.at).getTime() > seen).length,
          last_seen_at: res.last_seen_at
        }
      });
    } catch {
      // The panel still shows the items; the dot returns on the next load.
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="relative flex items-center justify-center w-10 h-10 rounded-xl text-ink-mute hover:text-accent hover:bg-accent/5 border border-transparent hover:border-accent/10 transition-[background-color,border-color,color,transform] duration-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target"
        aria-label={unread > 0 ? `Notifications (${unread} unread) · الإشعارات` : "Notifications · الإشعارات"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={18} strokeWidth={2} />
        {unread > 0 && (
          <span className="absolute top-2 right-2 w-[7px] h-[7px] bg-accent-warm rounded-full border border-paper" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto bg-paper/95 backdrop-blur-2xl border border-rule/50 rounded-2xl shadow-glass-xl p-2 z-50 animate-scale-in origin-top-right"
        >
          <div className="px-3 py-2.5 border-b border-rule/30 mb-1 flex items-center justify-between gap-2">
            <p className="text-sm font-sans font-semibold text-ink">
              <span className="font-arabic" dir="rtl">الإشعارات</span> · Notifications
            </p>
            {unread > 0 && <span className="text-[10px] font-mono text-accent-warm">{unread > 9 ? "9+" : unread} new</span>}
          </div>
          <PanelBody state={state} onNavigate={() => setOpen(false)} onRetry={() => void load()} />
        </div>
      )}
    </div>
  );
}

function PanelBody({ state, onNavigate, onRetry }: { state: LoadState; onNavigate: () => void; onRetry: () => void }) {
  if (state.status === "loading") {
    return <p className="px-3 py-6 text-center text-xs text-ink-mute">Loading… · جارٍ التحميل</p>;
  }
  if (state.status === "no_merchant") {
    return (
      <p className="px-3 py-6 text-center text-xs text-ink-mute">
        <span className="font-arabic block" dir="rtl">أكمل إعداد متجرك لتصلك الإشعارات.</span>
        Finish setting up your store to receive notifications.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="px-3 py-6 text-center text-xs text-danger" role="alert">
        <p>{state.message}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-accent hover:underline">
          Retry · إعادة المحاولة
        </button>
      </div>
    );
  }
  if (state.feed.items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-ink-mute">
        <span className="font-arabic block" dir="rtl">لا شيء يحتاج انتباهك الآن.</span>
        Nothing needs your attention right now.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-rule/20">
      {state.feed.items.map((item) => (
        <NotificationRow key={item.id} item={item} onNavigate={onNavigate} />
      ))}
    </ul>
  );
}

function NotificationRow({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex gap-2.5 px-3 py-2.5 rounded-xl hover:bg-paper-deep/50 transition-colors",
          item.unread && "bg-accent/[0.04]"
        )}
      >
        <span
          className={cn("mt-1.5 w-1.5 h-1.5 rounded-full shrink-0", item.unread ? "bg-accent-warm" : "bg-transparent")}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block font-arabic text-[13px] text-ink leading-snug" dir="rtl">
            {item.title.ar}
          </span>
          <span className="block text-[11px] text-ink-soft">{item.title.en}</span>
          {item.detail && (
            <span className="block text-[11px] text-ink-mute mt-0.5 truncate" dir="auto">
              {item.detail}
            </span>
          )}
          <span className="block text-[10px] font-mono text-ink-mute mt-0.5">{timeAgo(item.at)}</span>
        </span>
      </Link>
    </li>
  );
}
