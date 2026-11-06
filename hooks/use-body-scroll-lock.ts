"use client";

import { useEffect } from "react";

/**
 * Locks page scrolling while `locked` is true — for the More sheet, drawers and modal dialogs.
 *
 * Reference-counted: two overlays open at once (or one opening as another closes) keep the
 * page locked until the last one releases, and the body's original `overflow` is restored
 * exactly once. Setting `document.body.style.overflow` directly from several components let
 * the first one to close unlock the page under another overlay that was still open.
 */

let holders = 0;
let savedOverflow: string | null = null;

function acquire() {
  if (holders === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  holders += 1;
}

function release() {
  if (holders === 0) return;
  holders -= 1;
  if (holders === 0) {
    document.body.style.overflow = savedOverflow ?? "";
    savedOverflow = null;
  }
}

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    acquire();
    return release;
  }, [locked]);
}
