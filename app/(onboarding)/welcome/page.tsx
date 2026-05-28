"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { LogoFull } from "@/components/ui/logo";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { Check } from "lucide-react";

type Step = 1 | 2 | 3 | 4;

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: business basics
  const [businessName, setBusinessName] = useState("");
  const [vatNumber, setVatNumber] = useState("");

  // Step 2: brand voice
  const [essence, setEssence] = useState("");
  const [attributes, setAttributes] = useState("");
  const [dialect, setDialect] = useState<"khaliji" | "msa" | "english">("khaliji");

  // Step 3: plan
  const [plan, setPlan] = useState<"lite" | "plus" | "pro">("plus");

  async function finish() {
    setSubmitting(true);
    const sb = getBrowserSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return router.push("/login");

    // Create merchant
    const { data: merchant } = await sb
      .from("merchants")
      .insert({
        owner_user_id: user.id,
        seller_name: businessName,
        vat_number: vatNumber || null,
        plan,
        subscription_status: "pending"
      })
      .select()
      .single();

    if (merchant) {
      await sb.from("brand_kits").upsert({
        merchant_id: merchant.id,
        brand_name: businessName,
        essence,
        attributes: attributes.split(",").map((s) => s.trim()).filter(Boolean),
        dialect
      });
    }

    router.push(`/billing?plan=${plan}`);
  }

  const stepLabel = (n: Step, label: string) => (
    <div className="flex items-center gap-2.5">
      <span
        className={`w-6 h-6 flex items-center justify-center text-xs font-mono ${
          step > n ? "bg-accent text-paper" : step === n ? "bg-ink text-paper" : "bg-paper-deep text-ink-mute"
        }`}
      >
        {step > n ? <Check size={12} /> : n}
      </span>
      <span className={`text-xs uppercase tracking-widest font-mono ${step >= n ? "text-ink" : "text-ink-mute"}`}>{label}</span>
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-rule px-6 lg:px-10 h-16 flex items-center justify-between">
        <LogoFull />
        <span className="text-xs font-mono text-ink-mute">SETUP {step}/4</span>
      </header>

      <div className="flex-1 flex items-start justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-4 mb-12 flex-wrap">
            {stepLabel(1, "Business")}
            {stepLabel(2, "Voice")}
            {stepLabel(3, "Plan")}
            {stepLabel(4, "Done")}
          </div>

          {step === 1 && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-4xl tracking-crisp">Let's set up your store.</h1>
                <p className="mt-3 text-ink-soft">We'll use these for ZATCA invoicing. You can update them anytime.</p>
              </div>
              <Field label="Business legal name">
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g., Bayt Al-Oud" />
              </Field>
              <Field label="VAT number" hint="15 digits — leave blank if not yet registered. You'll need this before the ZATCA deadline.">
                <Input value={vatNumber} maxLength={15} onChange={(e) => setVatNumber(e.target.value)} placeholder="3xxxxxxxxxxxxxx" />
              </Field>
              <div className="flex justify-end">
                <Button onClick={() => setStep(2)} disabled={!businessName}>Continue</Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-4xl tracking-crisp">Your voice.</h1>
                <p className="mt-3 text-ink-soft">The social agent will write in this voice. You can refine it later.</p>
              </div>
              <Field label="Essence" hint="One line: what you sell + who for.">
                <Textarea rows={2} value={essence} onChange={(e) => setEssence(e.target.value)} placeholder="Premium oud and bakhoor for Saudi families." />
              </Field>
              <Field label="Voice attributes" hint="3–7, comma-separated">
                <Input value={attributes} onChange={(e) => setAttributes(e.target.value)} placeholder="confident, warm, rooted-in-tradition" />
              </Field>
              <Field label="Dialect">
                <select
                  className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm"
                  value={dialect}
                  onChange={(e) => setDialect(e.target.value as "khaliji" | "msa" | "english")}
                >
                  <option value="khaliji">Khaliji (Saudi Arabic)</option>
                  <option value="msa">MSA (Fusha)</option>
                  <option value="english">English</option>
                </select>
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)}>Continue</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-4xl tracking-crisp">Pick a plan.</h1>
                <p className="mt-3 text-ink-soft">You can change this anytime. Billed in SAR through Moyasar.</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {(["lite", "plus", "pro"] as const).map((p) => (
                  <label
                    key={p}
                    className={`cursor-pointer border p-5 flex items-center justify-between transition ${
                      plan === p ? "border-ink bg-paper-deep/40" : "border-rule"
                    }`}
                  >
                    <div>
                      <div className="font-display text-2xl tracking-crisp capitalize">{p}</div>
                      <div className="text-xs text-ink-mute mt-1 font-mono uppercase tracking-widest">
                        {p === "lite" ? "99 SAR/mo · ZATCA only" : p === "plus" ? "299 SAR/mo · + social + voice" : "599 SAR/mo · all modules"}
                      </div>
                    </div>
                    <input type="radio" name="plan" value={p} checked={plan === p} onChange={() => setPlan(p)} className="accent-ink" />
                  </label>
                ))}
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                <Button onClick={() => setStep(4)}>Continue</Button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="space-y-6">
              <div>
                <h1 className="font-display text-4xl tracking-crisp">Ready.</h1>
                <p className="mt-3 text-ink-soft">Complete payment to activate your plan, then connect Salla from Integrations.</p>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2"><Check size={14} className="text-accent" />Business: <strong>{businessName}</strong></li>
                <li className="flex items-center gap-2"><Check size={14} className="text-accent" />Dialect: <strong className="capitalize">{dialect}</strong></li>
                <li className="flex items-center gap-2"><Check size={14} className="text-accent" />Plan: <strong className="capitalize">{plan}</strong></li>
              </ul>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                <Button onClick={finish} disabled={submitting}>{submitting ? "Setting up…" : "Continue to payment"}</Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
