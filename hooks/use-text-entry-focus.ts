"use client";

import { useSyncExternalStore } from "react";
import { isTextEntryElement } from "@/lib/hooks/viewport";

/**
 * True while a text-entry control (text-like input, textarea, contenteditable) has focus on a
 * touch device — i.e. while the on-screen keyboard is up. The dashboard chrome uses it to slide
 * the bottom tab bar and the floating launchers away so they do not ride on top of the keyboard
 * and cover the field being typed in (critic-15).
 *
 * Gated on `(pointer: coarse)`: a narrow desktop window has no on-screen keyboard, so its tab
 * bar never hides. `focusout` is re-checked on the next task, after the matching `focusin`,
 * so moving between two fields does not flash the bar in and out.
 */

const COARSE_POINTER = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  let timer: number | undefined;
  const deferred = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 0);
  };
  const mq = window.matchMedia?.(COARSE_POINTER);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", deferred);
  mq?.addEventListener?.("change", onChange);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", deferred);
    mq?.removeEventListener?.("change", onChange);
  };
}

function getSnapshot(): boolean {
  if (!window.matchMedia?.(COARSE_POINTER).matches) return false;
  return isTextEntryElement(document.activeElement as HTMLInputElement | null);
}

const getServerSnapshot = () => false;

export function useTextEntryFocus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
