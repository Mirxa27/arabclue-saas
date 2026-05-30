"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LogoFull } from "@/components/ui/logo";
import {
  ChevronLeft,
  Menu,
  Shield,
  LogOut,
} from "lucide-react";
import {
  DASHBOARD_ACCOUNT_NAV,
  DASHBOARD_CORE_NAV,
  DASHBOARD_NAV,
  DASHBOARD_TOOLS_NAV,
  isDashboardNavActive,
  type DashboardNavItem,
} from "@/lib/navigation/dashboard-nav";

function SlidingPill({ activeIndex }: { activeIndex: number | null }) {
  if (activeIndex === null || activeIndex < 0) return null;
  const itemHeight = 44;
  const gap = 4;
  const top = 4 + activeIndex * (itemHeight + gap);
  return (
    <div
      className="absolute left-1.5 right-1.5 h-[44px] rounded-xl bg-accent/10 border border-accent/15 transition-all duration-300 pointer-events-none z-0"
      style={{ transform: `translateY(${top}px)` }}
      aria-hidden="true"
    />
  );
}

function NavLink({
  item,
  active,
  onClick,
}: {
  item: DashboardNavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group relative z-10 flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        active ? "text-accent" : "text-ink-soft hover:text-ink",
      )}
    >
      <Icon
        size={16}
        className={cn(
          "shrink-0 transition-all duration-300",
          active ? "stroke-[2.5px] text-accent" : "stroke-[2px] text-ink-mute group-hover:text-ink",
        )}
      />
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-accent-warm/15 text-accent-warm">
          {item.badge}
        </span>
      )}
      {item.shortcut && (
        <kbd className="ml-auto hidden group-hover:inline-flex items-center justify-center w-5 h-5 text-[9px] font-mono text-ink-mute bg-rule/40 rounded-md">
          {item.shortcut}
        </kbd>
      )}
    </Link>
  );
}

interface SidebarProps {
  showAdminLink?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ showAdminLink = false, collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    function handleShortcut(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() === "k") return;
      const match = DASHBOARD_NAV.find((item) => item.shortcut === e.key);
      if (match) {
        e.preventDefault();
        router.push(match.href);
      }
      if (showAdminLink && e.key === "0") {
        e.preventDefault();
        router.push("/admin");
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [router, showAdminLink]);

  const isActive = (href: string) => isDashboardNavActive(pathname, href);
  const activePillIndex = DASHBOARD_CORE_NAV.findIndex((item) => isActive(item.href));

  const sidebarContent = (
    <>
      <div className="px-5 py-4 border-b border-rule/40 flex items-center justify-between shrink-0">
        <Link href="/dashboard" className="transition-opacity hover:opacity-90">
          <LogoFull />
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-paper-deep/50 text-ink-mute hover:text-ink transition-colors touch-target"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft
              size={16}
              className={cn("transition-transform duration-300", collapsed && "rotate-180")}
            />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        <div className="space-y-1">
          <p className="px-3 mb-2 text-[10px] font-mono tracking-widest uppercase text-ink-mute">Core</p>
          <div className="relative">
            <SlidingPill activeIndex={activePillIndex} />
            {DASHBOARD_CORE_NAV.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <p className="px-3 mb-2 text-[10px] font-mono tracking-widest uppercase text-ink-mute">Tools</p>
          {DASHBOARD_TOOLS_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </div>

        <div className="space-y-1">
          {DASHBOARD_ACCOUNT_NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
          {showAdminLink && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 border mt-2",
                pathname.startsWith("/admin")
                  ? "bg-accent-warm/12 text-accent-warm-deep border-accent-warm/20"
                  : "border-rule/30 text-ink-soft hover:bg-paper-deep/40 hover:text-ink",
              )}
            >
              <Shield
                size={16}
                className={cn(
                  pathname.startsWith("/admin") ? "stroke-[2.5px] text-accent-warm" : "text-ink-mute stroke-[2px]",
                )}
              />
              <span>Admin</span>
              <kbd className="ml-auto hidden group-hover:inline-flex text-[9px] font-mono text-ink-mute bg-rule/40 px-1 rounded">
                ⌘0
              </kbd>
            </Link>
          )}
        </div>
      </nav>

      <div className="shrink-0 p-3 border-t border-rule/40">
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-ink-soft hover:text-accent-warm hover:bg-accent-warm/5 border border-transparent hover:border-accent-warm/10 transition-all duration-300 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/40"
          >
            <LogOut size={16} className="text-ink-mute" />
            <span>Log out</span>
          </button>
        </form>
      </div>
    </>
  );

  const collapsedItems = [...DASHBOARD_NAV];

  return (
    <aside
      className={cn(
        "dashboard-sidebar hidden lg:flex flex-col h-screen sticky top-0 shrink-0 transition-all duration-300 overflow-hidden",
        collapsed ? "w-[72px]" : "w-60",
      )}
    >
      {collapsed ? (
        <>
          <div className="px-4 py-4 border-b border-rule/40 flex justify-center shrink-0">
            <button
              type="button"
              onClick={onToggle}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-paper-deep/50 text-ink-mute hover:text-ink transition-colors touch-target"
              aria-label="Expand sidebar"
            >
              <Menu size={18} />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {collapsedItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={cn(
                    "flex items-center justify-center w-12 h-12 mx-auto rounded-xl transition-all duration-300",
                    active
                      ? "bg-accent/10 text-accent border border-accent/15"
                      : "text-ink-mute hover:bg-paper-deep/40 hover:text-ink border border-transparent",
                  )}
                >
                  <Icon size={20} aria-hidden className={cn(active ? "stroke-[2.5px]" : "stroke-[2px]")} />
                </Link>
              );
            })}
            {showAdminLink && (
              <Link
                href="/admin"
                aria-label="Admin"
                className={cn(
                  "flex items-center justify-center w-12 h-12 mx-auto rounded-xl transition-all duration-300 border mt-2",
                  pathname.startsWith("/admin")
                    ? "bg-accent-warm/12 text-accent-warm border-accent-warm/20"
                    : "border-rule/30 text-ink-mute hover:bg-paper-deep/40 hover:text-ink",
                )}
              >
                <Shield size={20} aria-hidden className={cn(pathname.startsWith("/admin") ? "stroke-[2.5px]" : "stroke-[2px]")} />
              </Link>
            )}
          </nav>
          <div className="shrink-0 p-3 border-t border-rule/40">
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                aria-label="Log out"
                className="flex items-center justify-center w-12 h-12 mx-auto rounded-xl text-ink-mute hover:text-accent-warm hover:bg-accent-warm/5 border border-transparent hover:border-accent-warm/10 transition-all duration-300"
              >
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </>
      ) : (
        sidebarContent
      )}
    </aside>
  );
}
