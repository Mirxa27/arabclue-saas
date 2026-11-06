"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { AuthMessage } from "@/components/auth/auth-message";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { loginErrorMessage, type LoginErrorCode } from "@/lib/auth/login-errors";
import Link from "next/link";

function SignupForm() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => safeRedirectPath(searchParams.get("next")), [searchParams]);
  const loginHref = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, mode: "signup", name, ...(nextPath ? { next: nextPath } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: LoginErrorCode };
      if (!res.ok) {
        setError(data.code ?? (res.status === 429 ? "rate_limited" : "unknown"));
        setState("error");
      } else {
        setState("sent");
      }
    } catch {
      setError("auth_unavailable");
      setState("error");
    }
  }

  return (
    <div>
      <div className="marker-numeral mb-4">٠١ — CREATE ACCOUNT</div>
      <h1 className="font-display text-4xl tracking-crisp leading-tight">Start with arabclue.</h1>
      <p className="mt-3 text-ink-soft">Free to set up. You only pay when you connect a Salla store and pick a plan.</p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <Field label="Your name">
          <Input
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            placeholder="Abdullah Mirza"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={state === "sending"}
          />
        </Field>
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
          {state === "sending" ? "Sending…" : state === "sent" ? "Check your inbox" : "Create account"}
        </Button>

        {error && <AuthMessage tone="error" text={loginErrorMessage(error)} />}
        {state === "sent" && (
          <AuthMessage
            tone="success"
            text={{
              ar: "أرسلنا رابط التأكيد إلى بريدك. افتحه لإكمال إنشاء حسابك.",
              en: "We sent a verification link to your inbox. Open it to finish creating your account.",
            }}
          />
        )}
      </form>

      <div className="rule my-10" />
      <p className="text-sm text-ink-soft text-center">
        Already have an account?{" "}
        <Link href={loginHref} className="underline underline-offset-4 hover:text-ink">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink-mute">Loading…</div>}>
      <SignupForm />
    </Suspense>
  );
}
