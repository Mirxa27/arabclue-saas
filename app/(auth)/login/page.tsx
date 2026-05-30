"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import Link from "next/link";

function safeNextPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (next.startsWith("/login") || next.startsWith("/signup")) return null;
  return next;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);

  const redirectTo = useMemo(() => {
    if (!nextPath || typeof window === "undefined") return undefined;
    return `${window.location.origin}${nextPath}`;
  }, [nextPath]);

  const signupHref = nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const res = await fetch("/api/auth/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        mode: "login",
        ...(redirectTo ? { redirectTo } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not send magic link");
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div>
      <div className="marker-numeral mb-4">٠١ — SIGN IN</div>
      <h1 className="font-display text-4xl tracking-crisp leading-tight">Welcome back.</h1>
      <p className="mt-3 text-ink-soft">We&apos;ll send a magic link to your inbox — no passwords to remember.</p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <Field label="Work email">
          <Input
            type="email"
            required
            placeholder="you@yourstore.sa"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={state === "sending"}
          />
        </Field>

        <Button type="submit" disabled={state === "sending" || state === "sent"} className="w-full">
          {state === "sending" ? "Sending…" : state === "sent" ? "Check your inbox" : "Send magic link"}
        </Button>

        {error && <p className="text-sm text-accent-warm-deep">{error}</p>}
        {state === "sent" && (
          <p className="text-sm text-accent-deep">
            Magic link sent to <strong>{email}</strong>. Click it to sign in
            {nextPath ? ` and return to ${nextPath}` : ""}.
          </p>
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
