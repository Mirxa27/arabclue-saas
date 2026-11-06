"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: string;
  children: React.ReactNode;
}

/**
 * Side sheet / drawer. Portaled to <body> on the overlay layer (backdrop z-[60], panel z-[61]),
 * so it covers the dashboard chrome even when opened from inside a page; locks page scroll
 * (reference-counted), closes on Escape, moves focus in on open and back on close, and pads
 * its header/body for the safe areas.
 */
export function Sheet({ open, onClose, side = "right", title, children }: SheetProps) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  // Latest onClose without re-running the open effect (callers pass inline functions; a
  // re-run would yank focus back to the close button on every render).
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });
  useBodyScrollLock(open);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] bg-ink/20 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          "fixed inset-y-0 z-[61] flex w-full max-w-md flex-col bg-paper/90 backdrop-blur-xl border-rule/50 shadow-glass-xl",
          side === "right"
            ? "right-0 border-l animate-slide-in-right rounded-l-3xl pr-[var(--safe-right)]"
            : "left-0 border-r animate-slide-in-left rounded-r-3xl pl-[var(--safe-left)]",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-rule/30 bg-paper/80 px-5 pb-5 pt-[max(1.25rem,var(--safe-top))] backdrop-blur-md">
          <h2 className="font-display text-xl tracking-crisp" dir="auto">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-me-2 flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-paper-deep/50"
            aria-label="إغلاق · Close"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-[calc(1.25rem+var(--safe-bottom))]">
          {children}
        </div>
      </div>
    </Portal>
  );
}
