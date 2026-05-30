"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useMerchant } from "@/hooks/use-merchant";
import {
  Search,
  Bell,
  CalendarDays,
  ChevronDown,
  LogOut,
  Settings,
  Sparkles,
} from "lucide-react";
import type { Merchant } from "@/lib/types/database";

function useCurrentTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return time;
}

function Greeting({ merchantName }: { merchantName: string }) {
  const now = useCurrentTime();
  const hour = now.getHours();
  let greeting: string;
  if (hour < 12) greeting = "صباح الخير";
  else if (hour < 17) greeting = "مساء الخير";
  else greeting = "مساء النور";

  const formatted = new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return (
    <div className="flex-1 min-w-0">
      <h1 className="text-base sm:text-lg font-sans font-semibold text-ink leading-tight tracking-tight truncate">
        {greeting}، {merchantName || "المستخدم"}
      </h1>
      <p className="text-[11px] sm:text-xs text-ink-mute font-sans mt-0.5 tracking-wide">
        {formatted}
      </p>
    </div>
  );
}

export function Topbar({
  merchant: propMerchant,
  title,
}: {
  merchant?: Merchant | null;
  title?: ReactNode;
}) {
  const { merchant: hookMerchant, loading } = useMerchant();
  const merchant = propMerchant ?? hookMerchant;
  const [isScrolled, setIsScrolled] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(new CustomEvent("arabclue:command-palette"));
  }, []);

  // Detect scroll for frosted effect
  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > 10);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsProfileOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const merchantName = merchant?.store_name ?? merchant?.name ?? "";

  return (
    <header className="sticky top-0 z-30 w-full px-3 sm:px-5 lg:px-8 pt-3">
      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-2xl border px-4 sm:px-5 h-16 sm:h-[4.5rem] transition-[background-color,border-color,box-shadow] duration-300",
          isScrolled
            ? "bg-paper/78 backdrop-blur-2xl border-rule/55 shadow-glass-md"
            : "bg-paper/42 backdrop-blur-xl border-rule/30 shadow-glass-sm"
        )}
      >

        {/* Left: Greeting / Title */}
        <div className="flex-1 min-w-0">
          <Greeting merchantName={merchantName} />
          {title && (
            <div className="hidden lg:block mt-1 text-[11px] font-mono uppercase tracking-widest text-ink-mute">
              {title}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Search Toggle */}
          <button
            type="button"
            onClick={openCommandPalette}
            className="hidden sm:flex items-center gap-2 px-3 h-10 rounded-xl text-sm text-ink-mute bg-paper/45 backdrop-blur-md border border-rule/40 hover:border-rule hover:text-ink hover:bg-paper/70 transition-[background-color,border-color,color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target"
            aria-label="Open quick navigation"
          >
            <Search size={15} strokeWidth={2.5} />
            <span className="text-[13px] hidden md:inline">
              Quick search...
            </span>
            <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 h-5 text-[10px] font-mono text-ink-mute bg-rule/30 rounded-md">
              ⌘K
            </kbd>
          </button>

          {/* Notifications */}
          <button
            type="button"
            className="relative flex items-center justify-center w-10 h-10 rounded-xl text-ink-mute hover:text-accent hover:bg-accent/5 border border-transparent hover:border-accent/10 transition-[background-color,border-color,color,transform] duration-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target"
            aria-label="Notifications"
          >
            <Bell size={18} strokeWidth={2} />
            <span className="absolute top-2 right-2 w-[7px] h-[7px] bg-accent-warm rounded-full border border-paper" />
          </button>

          {/* Date Trigger */}
          <Link
            href="/social"
            className="hidden md:flex items-center justify-center w-10 h-10 rounded-xl text-ink-mute hover:text-ink hover:bg-paper/65 border border-transparent hover:border-rule transition-[background-color,border-color,color,transform] duration-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target"
            aria-label="Open social calendar"
          >
            <CalendarDays size={18} strokeWidth={2} />
          </Link>

          {/* Profile Dropdown */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className={cn(
                "flex items-center gap-2 px-2.5 sm:px-3 h-10 rounded-xl border transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 touch-target",
                isProfileOpen
                  ? "bg-accent/5 border-accent/20 text-accent shadow-glass-sm"
                  : "bg-paper-deep/20 border-rule/40 text-ink-soft hover:bg-paper-deep/50 hover:text-ink hover:border-rule"
              )}
              aria-expanded={isProfileOpen}
              aria-label="Profile menu"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent to-accent-warm flex items-center justify-center text-paper text-[10px] font-bold font-mono ring-2 ring-paper">
                {merchantName ? merchantName[0].toUpperCase() : "A"}
              </div>
              <span className="text-[13px] font-sans font-semibold max-w-[100px] truncate hidden sm:inline">
                {merchantName || "Account"}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2.5}
                className={cn(
                  "hidden sm:block transition-transform duration-300",
                  isProfileOpen && "rotate-180"
                )}
              />
            </button>

            {/* Dropdown Menu */}
            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-paper/95 backdrop-blur-2xl border border-rule/50 rounded-2xl shadow-glass-xl p-2 z-50 animate-scale-in origin-top-right">
                <div className="px-3 py-2.5 border-b border-rule/30 mb-1">
                  <p className="text-sm font-sans font-semibold text-ink truncate">
                    {merchantName || "Account"}
                  </p>
                  <p className="text-[11px] text-ink-mute font-mono mt-0.5 truncate">
                    {merchant?.email ?? "email@example.com"}
                  </p>
                </div>

                <Link
                  href="/settings"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-deep/60 rounded-xl transition-all duration-200"
                >
                  <Settings size={15} strokeWidth={2} />
                  <span>Settings</span>
                </Link>

                <Link
                  href="/brand"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-soft hover:text-ink hover:bg-paper-deep/60 rounded-xl transition-all duration-200"
                >
                  <Sparkles size={15} strokeWidth={2} />
                  <span>Brand Kit</span>
                </Link>

                <div className="border-t border-rule/30 mt-1 pt-1">
                  <form action="/api/auth/logout" method="post">
                    <button
                      type="submit"
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-accent-warm hover:bg-accent-warm/5 rounded-xl transition-all duration-200"
                    >
                      <LogOut size={15} strokeWidth={2} />
                      <span>Log out</span>
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}