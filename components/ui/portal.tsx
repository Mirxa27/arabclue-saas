"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};

/**
 * Renders `children` into `document.body` (client only; nothing on the server pass).
 *
 * Page-level overlays (drawers, modals, sheets) must render through this: inside a dashboard
 * page they sit in `.dashboard-content-glass`, whose backdrop-filter makes it the containing
 * block and stacking context of every `position: fixed` descendant, so `fixed inset-0 z-[60]`
 * there is neither full-screen nor above the chrome. From <body> they use the stacking model in
 * app/globals.css (backdrop z-[60], panel z-[61]).
 */
export function Portal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return isClient ? createPortal(children, document.body) : null;
}
