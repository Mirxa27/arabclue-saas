"use client";

import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

/**
 * Mounted once in app/layout.tsx: keeps `--kb-inset` on <html> in sync with the visual
 * viewport so bottom-anchored UI can sit above the iOS on-screen keyboard. Renders nothing.
 */
export function ViewportInsets() {
  useKeyboardInset();
  return null;
}
