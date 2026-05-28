"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const sb = getBrowserSupabase();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` }
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div>
      <div className="marker-numeral mb-4">٠١ — SIGN IN</div>
      <h1 className="font-display text-4xl tracking-crisp leading-tight">Welcome back.</h1>
      <p className="mt-3 text-ink-soft">We'll send a magic link to your inbox — no passwords to remember.</p>

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
            Magic link sent to <strong>{email}</strong>. Click it to sign in.
          </p>
        )}
      </form>

      <div className="rule my-10" />

      <p className="text-sm text-ink-soft text-center">
        New to arabclue?{" "}
        <Link href="/signup" className="underline underline-offset-4 hover:text-ink">
          Create an account
        </Link>
      </p>
    </div>
  );
}
