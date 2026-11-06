"use client";

import { useEffect, useRef, useState } from "react";
import { parseAuthFragment } from "@/lib/auth/implicit-session";
import { DEFAULT_AFTER_LOGIN, loginPath, safeRedirectPath } from "@/lib/auth/redirect";

/**
 * Finishes magic links that were sent with the old implicit flow: Supabase redirected them to
 * `…#access_token=…&refresh_token=…` (or `#error=…`), which the server never sees.
 *
 * Mounted on /login and the landing page. Reads the fragment once, removes it from the address
 * bar and history immediately, then POSTs the tokens to /auth/session (validated server-side)
 * and continues to the validated `?next=`. Renders nothing unless it is working.
 */
export function ImplicitSessionRescue() {
  const started = useRef(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = parseAuthFragment(window.location.hash);
    if (!fragment) return;

    const { pathname, search } = window.location;
    // Never leave tokens (or Supabase's error text) in the URL bar or browser history.
    window.history.replaceState(window.history.state, "", `${pathname}${search}`);

    const query = new URLSearchParams(search);
    const next = safeRedirectPath(query.get("next")) ?? DEFAULT_AFTER_LOGIN;

    if (fragment.kind === "error") {
      // /login?error=… already explains the failure (the fragment was just inherited).
      if (pathname === "/login" && query.has("error")) return;
      window.location.replace(loginPath({ error: fragment.code, next }));
      return;
    }

    setActive(true);
    fetch("/auth/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        access_token: fragment.accessToken,
        refresh_token: fragment.refreshToken,
        next
      })
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { next?: string };
        window.location.replace(res.ok ? safeRedirectPath(data.next) ?? next : loginPath({ error: "session_failed", next }));
      })
      .catch(() => window.location.replace(loginPath({ error: "session_failed", next })));
  }, []);

  if (!active) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-0.5 bg-ink px-4 py-3 text-center text-sm text-paper"
    >
      <span className="font-arabic" dir="rtl" lang="ar">
        جارٍ تسجيل دخولك…
      </span>
      <span>Signing you in…</span>
    </div>
  );
}
