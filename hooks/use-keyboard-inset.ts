"use client";

import { useSyncExternalStore } from "react";
import { computeKeyboardInset } from "@/lib/hooks/viewport";

/**
 * Keeps the `--kb-inset` CSS variable on <html> in sync with `window.visualViewport` and
 * returns the current keyboard inset in CSS px (0 when no keyboard covers the page).
 *
 * Bottom-anchored UI offsets itself by `max(var(--safe-bottom), var(--kb-inset))` (the
 * dashboard chrome folds it into `--chrome-bottom`), so on iOS Safari — which overlays the
 * keyboard and ignores `interactive-widget` — panels and composers sit above the keyboard.
 * Chromium resizes the layout viewport instead (`interactiveWidget: "resizes-content"`), so
 * there the inset stays 0.
 *
 * One shared subscription serves every caller; it is mounted once for the whole app by
 * <ViewportInsets /> in app/layout.tsx, so components normally just read the CSS variable.
 */

const CSS_VAR = "--kb-inset";

let current = 0;
let pending = false;
let frame = 0;
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();

function measure() {
  const next = computeKeyboardInset(window.innerHeight, window.visualViewport);
  if (next === current) return;
  current = next;
  document.documentElement.style.setProperty(CSS_VAR, `${next}px`);
  listeners.forEach((listener) => listener());
}

/** One measurement per frame however many resize/scroll events fire (also with a sync rAF). */
function schedule() {
  if (pending) return;
  pending = true;
  frame = window.requestAnimationFrame(() => {
    pending = false;
    measure();
  });
}

function start() {
  const vv = window.visualViewport;
  if (!vv) return null;
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  measure();
  return () => {
    vv.removeEventListener("resize", schedule);
    vv.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    if (pending) window.cancelAnimationFrame(frame);
    pending = false;
    frame = 0;
    current = 0;
    document.documentElement.style.removeProperty(CSS_VAR);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

const getSnapshot = () => current;
const getServerSnapshot = () => 0;

export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
