"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { AuthMessage } from "@/components/auth/auth-message";
import { useAuthFragment } from "@/components/auth/legacy-link-notice";
import { fragmentNoticeCode } from "@/lib/auth/auth-fragment";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { loginErrorMessage, type LoginErrorCode } from "@/lib/auth/login-errors";
import Link from "next/link";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [requestError, setRequestError] = useState<string | null>(null);

  const nextPath = useMemo(() => safeRedirectPath(searchParams.get("next")), [searchParams]);
  // Set by /auth/callback and /auth/confirm when a link fails. Only the code is read; the
  // message is fixed text from lib/auth/login-errors (unknown codes → generic message).
  const linkError = searchParams.get("error");
  // A pre-PKCE link's #access_token=… (or Supabase's #error=…) is stripped and never used.
  const authFragment = useAuthFragment();
  const fragmentError = fragmentNoticeCode(authFragment, linkError);
  const shownError = requestError ?? (state === "idle" ? (fragmentError ?? linkError) : null);

  const signupHref = nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setRequestError(null);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, mode: "login", ...(nextPath ? { next: nextPath } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: LoginErrorCode };
      if (!res.ok) {
        setRequestError(data.code ?? (res.status === 429 ? "rate_limited" : "unknown"));
        setState("error");
      } else {
        setState("sent");
      }
    } catch {
      setRequestError("auth_unavailable");
      setState("error");
    }
  }

  return (
    <div>
      <div className="marker-numeral mb-4">٠١ — SIGN IN</div>
      <h1 className="font-display text-4xl tracking-crisp leading-tight">Welcome back.</h1>
      <p className="mt-3 text-ink-soft">We&apos;ll send a magic link to your inbox — no passwords to remember.</p>

      {shownError && (
        <AuthMessage tone="error" className="mt-8" text={loginErrorMessage(shownError)} />
      )}

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <Field label="Work email">
          <Input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="you@yourstore.sa"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state === "sending"}
          />
        </Field>

        <Button type="submit" disabled={state === "sending" || state === "sent"} className="w-full">
          {state === "sending" ? "Sending…" : state === "sent" ? "Check your inbox" : "Send magic link"}
        </Button>

        {state === "sent" && (
          <AuthMessage
            tone="success"
            text={{
              ar: "أرسلنا رابط الدخول إلى بريدك. افتحه لتسجيل الدخول — صلاحيته محدودة ويُستخدم مرة واحدة.",
              en: "We sent a sign-in link to your inbox. Open it to sign in — it expires soon and works once.",
            }}
          />
        )}
      </form>

      <div className="rule my-10" />

      <p className="text-sm text-ink-soft text-center">
        New to arabclue?{" "}
        <Link href={signupHref} className="underline underline-offset-4 hover:text-ink">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink-mute">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
