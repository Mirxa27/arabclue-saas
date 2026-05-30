"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV, type DashboardNavItem } from "@/lib/navigation/dashboard-nav";

type Props = {
  showAdminLink?: boolean;
};

export function DashboardCommandPalette({ showAdminLink = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const admin: DashboardNavItem[] = showAdminLink
      ? [
          {
            href: "/admin",
            label: "Platform admin",
            shortLabel: "Admin",
            icon: Shield,
            section: "account" as const,
          },
        ]
      : [];
    return [...DASHBOARD_NAV, ...admin];
  }, [showAdminLink]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q) ||
        item.shortLabel?.toLowerCase().includes(q),
    );
  }, [items, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  useEffect(() => {
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("arabclue:command-palette", onOpenRequest);
    return () => window.removeEventListener("arabclue:command-palette", onOpenRequest);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") close();
      if (!open) return;
      const num = Number(e.key);
      if (e.metaKey || e.ctrlKey) {
        if (num >= 1 && num <= 9) {
          const withShortcut = items.find((i) => i.shortcut === e.key);
          if (withShortcut) {
            e.preventDefault();
            go(withShortcut.href);
          }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, go, items, open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        aria-label="Close command palette"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go to page"
        className="relative w-full max-w-lg rounded-2xl border border-rule/50 bg-paper/95 shadow-glass-xl backdrop-blur-2xl overflow-hidden animate-scale-in"
      >
        <div className="flex items-center gap-3 border-b border-rule/40 px-4">
          <Search size={18} className="shrink-0 text-ink-mute" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a page…"
            className="h-12 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-mute focus:outline-none"
          />
          <kbd className="hidden sm:inline text-[10px] font-mono text-ink-mute bg-rule/30 px-1.5 py-0.5 rounded">esc</kbd>
        </div>
        <ul className="max-h-[min(50vh,360px)] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-mute">No matching pages</li>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                      "hover:bg-paper-deep/60 text-ink-soft hover:text-ink",
                    )}
                  >
                    <Icon size={16} className="shrink-0 text-ink-mute" aria-hidden />
                    <span className="flex-1 font-medium">{item.label}</span>
                    {item.shortcut && (
                      <kbd className="text-[10px] font-mono text-ink-mute bg-rule/30 px-1.5 py-0.5 rounded">
                        ⌘{item.shortcut}
                      </kbd>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
