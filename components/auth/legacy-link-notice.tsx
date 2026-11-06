"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  consumeAuthFragment,
  fragmentNoticeCode,
  legacyLinkNoticeContent,
  type AuthFragment
} from "@/lib/auth/auth-fragment";
import type { LoginErrorCode } from "@/lib/auth/login-errors";

/**
 * Reads an auth fragment (`#access_token=…` from a pre-PKCE magic link, or Supabase's
 * `#error=…`) once on mount and strips it from the address bar. The tokens are never used or
 * sent anywhere — see lib/auth/auth-fragment.ts. Only a found fragment is stored, so React
 * Strict Mode's second effect run (fragment already gone) cannot clear it.
 */
export function useAuthFragment(): AuthFragment | null {
  const [fragment, setFragment] = useState<AuthFragment | null>(null);
  useEffect(() => {
    const found = consumeAuthFragment(window);
    if (found) setFragment(found);
  }, []);
  return fragment;
}

/** Landing page (`/`): GoTrue sends old and failed links back to the Site URL. */
export function LegacyLinkNotice() {
  const fragment = useAuthFragment();
  const [dismissed, setDismissed] = useState(false);
  const code = fragmentNoticeCode(fragment, null);
  if (!code || dismissed) return null;
  return <LegacyLinkBanner code={code} onDismiss={() => setDismissed(true)} />;
}

/** Fixed bilingual message for a sign-in link that cannot be used, with a way to get a new one. */
function LegacyLinkBanner({ code, onDismiss }: { code: LoginErrorCode; onDismiss: () => void }) {
  const { message, action } = legacyLinkNoticeContent(code);
  return (
    <div className="fixed inset-x-0 top-0 z-50 px-4 pt-3">
      <div
        role="alert"
        className="mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-accent-warm/40 bg-paper px-4 py-3 text-sm leading-relaxed text-accent-warm-deep shadow-lg"
      >
        <div className="flex-1 space-y-1">
          <p className="font-arabic" dir="rtl" lang="ar">
            {message.ar}
          </p>
          <p>{message.en}</p>
          <p>
            <Link href={action.href} className="font-medium underline underline-offset-4 hover:text-ink">
              <span className="font-arabic" lang="ar">
                {action.label.ar}
              </span>{" "}
              · {action.label.en}
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق · Dismiss"
          className="rounded-md p-1 text-ink-mute hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
