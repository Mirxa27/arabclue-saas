"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  X,
  LogOut,
  Shield,
  Home,
} from "lucide-react";
import {
  DASHBOARD_MOBILE_TABS,
  DASHBOARD_MORE_NAV,
  isDashboardNavActive,
  type DashboardNavItem,
} from "@/lib/navigation/dashboard-nav";

function TabIcon({ item, active }: { item: DashboardNavItem; active: boolean }) {
  const Icon = item.href === "/dashboard" ? Home : item.icon;
  return (
    <Icon
      width={22}
      height={22}
      className={cn("transition-all duration-300", active ? "stroke-[2.5px]" : "stroke-[2px]")}
    />
  );
}

export function MobileNav({ showAdminLink = false }: { showAdminLink?: boolean }) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY === null) return;
      if (e.touches[0].clientY - touchStartY > 80) {
        setIsMenuOpen(false);
        setTouchStartY(null);
      }
    },
    [touchStartY],
  );

  const handleTouchEnd = useCallback(() => {
    setTouchStartY(null);
  }, []);

  const isActive = (href: string) => isDashboardNavActive(pathname, href);

  const moreItems: DashboardNavItem[] = showAdminLink
    ? [
        ...DASHBOARD_MORE_NAV,
        {
          href: "/admin",
          label: "Platform admin",
          shortLabel: "Admin",
          icon: Shield,
          section: "account",
        },
      ]
    : DASHBOARD_MORE_NAV;

  const moreActive = moreItems.some((item) => isActive(item.href));

  return (
    <>
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 h-[calc(4.75rem+var(--safe-bottom))] bg-paper/78 backdrop-blur-2xl border-t border-rule/50 flex items-start justify-around px-1 pt-1.5 z-40 transition-[transform,box-shadow,background-color] duration-300",
          isMenuOpen ? "shadow-none" : "shadow-glass-lg",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary mobile navigation"
      >
        {DASHBOARD_MOBILE_TABS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                "relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-[color,transform,background-color] duration-300 select-none active:scale-95 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target",
                active ? "text-accent" : "text-ink-mute hover:text-ink",
              )}
            >
              <div className={cn("p-1.5 rounded-full transition-all duration-300 relative", active && "bg-accent/10")}>
                <TabIcon item={item} active={active} />
              </div>
              <span className="text-[10px] font-mono tracking-widest uppercase font-semibold leading-none">
                {item.shortLabel ?? item.label}
              </span>
              {active && <span className="absolute bottom-1 w-6 h-[2.5px] bg-accent rounded-full" />}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className={cn(
            "flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-[color,transform,background-color] duration-300 select-none active:scale-95 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target",
            isMenuOpen || moreActive ? "text-accent" : "text-ink-mute hover:text-ink",
          )}
          aria-expanded={isMenuOpen}
          aria-label="More navigation options"
        >
          <div className={cn("p-1.5 rounded-full transition-all duration-300", (isMenuOpen || moreActive) && "bg-accent/10")}>
            <MoreHorizontal
              size={22}
              className={cn("transition-all duration-300", isMenuOpen ? "stroke-[2.5px] rotate-90" : "stroke-[2px]")}
            />
          </div>
          <span className="text-[10px] font-mono tracking-widest uppercase font-semibold leading-none">More</span>
          {moreActive && !isMenuOpen && <span className="absolute bottom-1 w-6 h-[2.5px] bg-accent rounded-full" />}
        </button>
      </nav>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-xs animate-fade-in"
          onClick={() => setIsMenuOpen(false)}
          aria-hidden
        />
      )}

      <div
        className={cn(
          "fixed bottom-[calc(4.75rem+var(--safe-bottom))] left-0 right-0 max-h-[70vh] bg-paper/88 backdrop-blur-2xl border-t border-rule/60 rounded-t-[2rem] overflow-hidden z-50 transition-transform duration-300 ease-out",
          isMenuOpen ? "translate-y-0 shadow-glass-xl" : "translate-y-full",
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        ref={sheetRef}
      >
        <div className="flex justify-center pt-3 pb-1">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setIsMenuOpen(false)}
            className="w-10 h-1.5 bg-rule/60 rounded-full hover:bg-rule transition-colors cursor-pointer"
            aria-label="Close menu"
          />
        </div>

        <div className="px-6 pb-4 border-b border-rule/30 flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-widest uppercase text-ink-mute">All modules</span>
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            className="p-2 rounded-xl hover:bg-paper-deep/50 text-ink-mute hover:text-ink transition-colors touch-target"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 p-6 overflow-y-auto max-h-[50vh]">
          {moreItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={() => setIsMenuOpen(false)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all duration-300 active:scale-95 select-none text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target",
                  active
                    ? "bg-accent/10 border-accent/25 text-accent shadow-glass-sm"
                    : "bg-paper/50 border-rule/30 text-ink-soft hover:bg-paper-deep/50 hover:text-ink hover:border-rule/60",
                )}
              >
                <div
                  className={cn(
                    "p-2.5 rounded-full transition-colors duration-300",
                    active ? "bg-accent/15 text-accent" : "bg-paper-deep/30 text-ink-mute",
                  )}
                >
                  <Icon width={22} height={22} strokeWidth={active ? 2.5 : 2} />
                </div>
                <span className="text-[11px] font-sans font-semibold tracking-tight leading-tight">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="px-6 pb-8 pt-4 border-t border-rule/30 bg-paper-deep/20">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 border border-accent-warm/20 rounded-2xl text-sm font-sans font-semibold text-accent-warm hover:bg-accent-warm/5 active:scale-[0.98] transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/40 touch-target"
            >
              <LogOut size={17} />
              <span>Log out</span>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
