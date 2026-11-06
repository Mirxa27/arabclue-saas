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
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/** Downward finger travel on the sheet's handle/header that dismisses it. */
const SWIPE_DISMISS_PX = 80;

/** Keyboard-focusable elements inside the sheet, for the Tab focus trap. */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export const MORE_SHEET_ID = "mobile-more-sheet";

function TabIcon({ item, active }: { item: DashboardNavItem; active: boolean }) {
  const Icon = item.href === "/dashboard" ? Home : item.icon;
  return (
    <Icon
      width={22}
      height={22}
      aria-hidden
      className={cn("transition-all duration-300", active ? "stroke-[2.5px]" : "stroke-[2px]")}
    />
  );
}

export function MobileNav({
  showAdminLink = false,
  hidden = false,
}: {
  showAdminLink?: boolean;
  /** Slide the tab bar away (the chrome sets this while the on-screen keyboard is up). */
  hidden?: boolean;
}) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useBodyScrollLock(isMenuOpen);

  useEffect(() => {
    if (!isMenuOpen) {
      // Closing: hand focus back to the More button instead of dropping it on <body> (the
      // sheet goes inert, so focus cannot stay on its links).
      if (wasOpen.current) {
        wasOpen.current = false;
        const active = document.activeElement;
        if (!active || active === document.body || sheetRef.current?.contains(active)) {
          moreButtonRef.current?.focus({ preventScroll: true });
        }
      }
      return;
    }

    wasOpen.current = true;
    // The open sheet is visible and non-inert in this same commit (visibility switches
    // instantly on open), so initial focus lands.
    closeButtonRef.current?.focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
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

  // Swipe-to-dismiss starts only on the handle/header, so scrolling the module grid back up
  // (a downward finger move) never closes the sheet (MORESHEET-01).
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchStartY.current;
    const y = e.touches[0]?.clientY;
    if (start === null || y === undefined) return;
    if (y - start > SWIPE_DISMISS_PX) {
      touchStartY.current = null;
      setIsMenuOpen(false);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartY.current = null;
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
          "fixed inset-x-0 bottom-0 z-40 flex h-[calc(4.75rem+var(--safe-bottom))] items-start justify-around border-t border-rule/50 bg-paper/78 pb-[var(--safe-bottom)] pl-[max(0.25rem,var(--safe-left))] pr-[max(0.25rem,var(--safe-right))] pt-1.5 backdrop-blur-2xl",
          isMenuOpen ? "shadow-none" : "shadow-glass-lg",
          // Slides away while typing; visibility flips after the slide so it is not focusable.
          hidden
            ? "pointer-events-none invisible translate-y-full [transition:transform_200ms_ease-out,visibility_0s_linear_200ms,box-shadow_300ms]"
            : "visible translate-y-0 [transition:transform_200ms_ease-out,box-shadow_300ms]",
        )}
        inert={hidden}
        aria-hidden={hidden || undefined}
        aria-label="Primary mobile navigation"
      >
        {DASHBOARD_MOBILE_TABS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              aria-current={active ? "page" : undefined}
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
              {active && <span className="absolute bottom-1 w-6 h-[2.5px] bg-accent rounded-full" aria-hidden />}
            </Link>
          );
        })}

        <button
          ref={moreButtonRef}
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className={cn(
            "relative flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-[color,transform,background-color] duration-300 select-none active:scale-95 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target",
            isMenuOpen || moreActive ? "text-accent" : "text-ink-mute hover:text-ink",
          )}
          aria-expanded={isMenuOpen}
          aria-controls={MORE_SHEET_ID}
          aria-label="More navigation options"
        >
          <div className={cn("p-1.5 rounded-full transition-all duration-300", (isMenuOpen || moreActive) && "bg-accent/10")}>
            <MoreHorizontal
              size={22}
              aria-hidden
              className={cn("transition-all duration-300", isMenuOpen ? "stroke-[2.5px] rotate-90" : "stroke-[2px]")}
            />
          </div>
          <span className="text-[10px] font-mono tracking-widest uppercase font-semibold leading-none">More</span>
          {moreActive && !isMenuOpen && <span className="absolute bottom-1 w-6 h-[2.5px] bg-accent rounded-full" aria-hidden />}
        </button>
      </nav>

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-[60] bg-ink/30 backdrop-blur-xs animate-fade-in"
          onClick={closeMenu}
          aria-hidden
        />
      )}

      {/*
        MNAV-01: the closed sheet is moved fully below the viewport (its own height plus the
        tab bar it sits on), made inert and invisible, so it can never intercept tab taps.
        Visibility switches instantly on open (initial focus must land) and only after the
        slide on close.
      */}
      <div
        ref={sheetRef}
        id={MORE_SHEET_ID}
        data-state={isMenuOpen ? "open" : "closed"}
        inert={!isMenuOpen}
        aria-hidden={!isMenuOpen || undefined}
        role={isMenuOpen ? "dialog" : undefined}
        aria-modal={isMenuOpen ? true : undefined}
        aria-label="More navigation"
        className={cn(
          "fixed inset-x-0 bottom-[calc(4.75rem+var(--safe-bottom))] z-[61] flex max-h-[calc(100dvh-4.75rem-var(--safe-bottom)-max(0.5rem,var(--safe-top)))] flex-col overflow-hidden rounded-t-[2rem] border-t border-rule/60 bg-paper/88 backdrop-blur-2xl",
          isMenuOpen
            ? "visible translate-y-0 shadow-glass-xl [transition:transform_300ms_ease-out]"
            : "invisible pointer-events-none translate-y-[calc(100%+4.75rem+var(--safe-bottom))] [transition:transform_300ms_ease-out,visibility_0s_linear_300ms]",
        )}
      >
        <div
          className="shrink-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <div className="flex justify-center pt-1.5">
            {/* Drag handle: a pointer affordance only (the X below is the accessible close). */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={closeMenu}
              className="flex h-6 w-20 cursor-pointer items-center justify-center"
            >
              <span className="h-1.5 w-10 rounded-full bg-rule/60 transition-colors hover:bg-rule" />
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-rule/30 pb-3 pl-[max(1.5rem,var(--safe-left))] pr-[max(1rem,var(--safe-right))]">
            <span className="font-mono text-[11px] tracking-widest uppercase text-ink-mute">All modules</span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMenu}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-paper-deep/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label="Close menu"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-4 overflow-y-auto overscroll-contain py-5 pl-[max(1.5rem,var(--safe-left))] pr-[max(1.5rem,var(--safe-right))]">
          {moreItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={closeMenu}
                aria-current={active ? "page" : undefined}
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
                  <Icon width={22} height={22} strokeWidth={active ? 2.5 : 2} aria-hidden />
                </div>
                <span className="text-[11px] font-sans font-semibold tracking-tight leading-tight">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-rule/30 bg-paper-deep/20 pb-4 pt-3 pl-[max(1.5rem,var(--safe-left))] pr-[max(1.5rem,var(--safe-right))]">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 border border-accent-warm/20 rounded-2xl text-sm font-sans font-semibold text-accent-warm hover:bg-accent-warm/5 active:scale-[0.98] transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-warm/40 touch-target"
            >
              <LogOut size={17} aria-hidden />
              <span>Log out</span>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
