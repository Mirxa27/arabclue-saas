"use client";

/**
 * Interactive primitives (state, effects or event handlers). They live in a client module so
 * that Server Components can import everything from "@/components/ui/primitives" — this file is
 * re-exported there, and a server import of it becomes a client reference instead of running
 * hooks in the RSC layer.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Tabs ──────────────────────────────────────────────
interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 p-1 bg-paper-deep/40 backdrop-blur-sm rounded-2xl border border-rule/30">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 touch-target",
            activeTab === tab.id
              ? "bg-paper shadow-glass-sm text-ink"
              : "text-ink-mute hover:text-ink-soft hover:bg-paper/30"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              "text-[10px] font-mono px-1.5 py-0.5 rounded-full",
              activeTab === tab.id ? "bg-accent/10 text-accent" : "bg-rule/50 text-ink-mute"
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Dropdown Menu ─────────────────────────────────────
interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function Dropdown({ trigger, children, align = "left" }: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)} className="cursor-pointer touch-target flex items-center">
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-2 min-w-[180px] bg-paper/85 backdrop-blur-xl border border-rule/50 rounded-2xl shadow-glass-lg p-1.5 z-50 animate-scale-in origin-top",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  className,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "w-full text-left px-3 py-2.5 text-sm rounded-xl transition-all duration-200 font-medium",
        danger
          ? "text-accent-warm hover:bg-accent-warm/10"
          : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink",
        className
      )}
      {...props}
    />
  );
}

// ─── Tooltip ───────────────────────────────────────────
export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [show, setShow] = React.useState(false);
  
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-ink text-paper text-xs rounded-lg whitespace-nowrap z-50 animate-scale-in">
          {content}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 rotate-45 bg-ink" />
        </div>
      )}
    </div>
  );
}
