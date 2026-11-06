"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export type ToastTone = "default" | "success" | "error";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, string> = {
  default: "bg-ink/85 backdrop-blur-md text-paper border-ink/20 shadow-glass-lg",
  success: "bg-emerald-900/85 backdrop-blur-md text-emerald-50 border-emerald-500/30 shadow-glass-lg",
  error: "bg-red-900/85 backdrop-blur-md text-red-50 border-red-500/30 shadow-glass-lg",
};

// ── Swipe-to-dismiss wrapper for individual toast ──────────────────
function SwipeToDismiss({
  id,
  children,
  onDismiss,
}: {
  id: string;
  children: React.ReactNode;
  onDismiss: (id: string) => void;
}) {
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);

  const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    // Only track horizontal swipes when horizontal delta exceeds vertical
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setOffset(deltaX);
    }
  }, []);

  const handleTouchEnd = React.useCallback(() => {
    touchStartX.current = null;
    touchStartY.current = null;

    if (offset > 80 || offset < -80) {
      // Swipe threshold met — animate out then dismiss
      setDismissed(true);
      setTimeout(() => onDismiss(id), 300);
    } else {
      setOffset(0);
    }
  }, [offset, id, onDismiss]);

  return (
    <div
      role="status"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: `translateX(${dismissed ? (offset > 0 ? 200 : -200) : offset}px)`,
        opacity: dismissed ? 0 : Math.max(0, 1 - Math.abs(offset) / 200),
        transition: dismissed
          ? "transform 300ms ease-out, opacity 300ms ease-out"
          : offset === 0
          ? "transform 200ms ease-out"
          : "none",
      }}
      className="pointer-events-auto"
    >
      {children}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((message: string, tone: ToastTone = "default") => {
    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/*
        TOAST-01: below lg the stack spans the width at the top (inside the safe areas), clear
        of the tab bar, the floating launchers and the iOS keyboard; from lg (where the tab bar
        is gone) it sits bottom-right. The old `w-full` + `end-4` overflowed the start edge on
        phones and `mb-safe` was never defined.
      */}
      <div
        data-testid="toast-region"
        className="pointer-events-none fixed left-[max(1rem,var(--safe-left))] right-[max(1rem,var(--safe-right))] top-[max(1rem,var(--safe-top))] z-[100] flex flex-col gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:top-auto lg:w-full lg:max-w-sm"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((item) => (
          <SwipeToDismiss key={item.id} id={item.id} onDismiss={dismiss}>
            <div
              className={cn(
                "flex items-start gap-3 border px-4 py-3 text-sm shadow-lg rounded-xl animate-[rise_300ms_ease-out]",
                toneStyles[item.tone]
              )}
            >
              <span className="min-w-0 flex-1 break-words leading-snug" dir="auto">{item.message}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="opacity-70 hover:opacity-100 transition shrink-0 touch-target p-1 -m-1"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </SwipeToDismiss>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
