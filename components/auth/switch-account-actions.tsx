"use client";

import { useState } from "react";

/** Stay on the current account, or sign out and then use the emailed link. */
export function SwitchAccountActions({ continueHref, confirmUrl }: { continueHref: string; confirmUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function switchAccount() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!res.ok && res.status !== 303) throw new Error(String(res.status));
      window.location.assign(confirmUrl);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <a
        href={continueHref}
        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-rule px-4 text-sm"
      >
        Stay signed in · البقاء في حسابي
      </a>
      <button
        type="button"
        onClick={switchAccount}
        disabled={busy}
        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-ink px-4 text-sm text-paper disabled:opacity-60"
      >
        {busy ? "…" : "Sign out and use this link · تسجيل الخروج واستخدام الرابط"}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          Could not sign out. Please try again. · تعذّر تسجيل الخروج، حاول مرة أخرى.
        </p>
      )}
    </div>
  );
}
