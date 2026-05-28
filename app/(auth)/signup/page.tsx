"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const sb = getBrowserSupabase();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/welcome`
      }
    });
    if (error) { setError(error.message); setState("error"); }
    else setState("sent");
  }

  return (
    <div>
      <div className="marker-numeral mb-4">٠١ — CREATE ACCOUNT</div>
      <h1 className="font-display text-4xl tracking-crisp leading-tight">Start with arabclue.</h1>
      <p className="mt-3 text-ink-soft">Free to set up. You only pay when you connect a Salla store and pick a plan.</p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <Field label="Your name">
          <Input required placeholder="Abdullah Mirza" value={name} onChange={(e) => setName(e.target.value)} disabled={state === "sending"} />
        </Field>
        <Field label="Work email">
          <Input type="email" required placeholder="you@yourstore.sa" value={email} onChange={(e) => setEmail(e.target.value)} disabled={state === "sending"} />
        </Field>

        <Button type="submit" disabled={state === "sending" || state === "sent"} className="w-full">
          {state === "sending" ? "Sending…" : state === "sent" ? "Check your inbox" : "Create account"}
        </Button>

        {error && <p className="text-sm text-accent-warm-deep">{error}</p>}
        {state === "sent" && <p className="text-sm text-accent-deep">Verification link sent to {email}.</p>}
      </form>

      <div className="rule my-10" />
      <p className="text-sm text-ink-soft text-center">
        Already have an account? <Link href="/login" className="underline underline-offset-4 hover:text-ink">Sign in</Link>
      </p>
    </div>
  );
}
