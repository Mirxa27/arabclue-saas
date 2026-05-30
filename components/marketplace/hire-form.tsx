"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { Check, Loader2 } from "lucide-react";
import type { EmployeeRole, EmployeeTier } from "@/lib/employees/types";
import { TIER_LABELS, priceForTier, formatPriceSAR } from "@/lib/employees/catalog";
import type { Persona } from "@/lib/employees/personas";
import { useToast } from "@/components/ui/toast";

const TIER_ORDER: EmployeeTier[] = ["starter", "growth", "pro", "scale"];

export function HireForm({ role, personas = [] }: { role: EmployeeRole; personas?: Persona[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tier, setTier] = useState<EmployeeTier>("starter");
  const initialPersona = personas[0];
  const [personaId, setPersonaId] = useState<string | undefined>(initialPersona?.id);
  const [displayName, setDisplayName] = useState(initialPersona?.name ?? role.name);
  const [loading, setLoading] = useState(false);

  function pickPersona(p: Persona) {
    setPersonaId(p.id);
    setDisplayName(p.name);
  }

  async function handleHire() {
    setLoading(true);
    try {
      const selected = personas.find((p) => p.id === personaId);
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role_id: role.id,
          display_name: displayName.trim() || role.name,
          hire_plan: tier,
          language: role.defaultLanguage === "ar" ? "ar-en" : role.defaultLanguage,
          tone: role.defaultTone,
          avatar: selected?.emoji ?? role.emoji,
          config: selected
            ? {
                persona_id: selected.id,
                persona_name: selected.name,
                persona_arabic_name: selected.arabicName,
                persona_age: selected.age,
                persona_gender: selected.gender,
                persona_nationality: selected.nationality,
                persona_city: selected.city,
                persona_dialect: selected.dialect,
                persona_voice: selected.voice,
                persona_background: selected.background,
                persona_signature: selected.signature
              }
            : undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Failed to hire");
      }
      const employee = (data as { employee: { id: string } }).employee;
      toast(`${displayName} joined your team — ${role.trialDays}-day trial started`, "success");
      router.push(`/employees/${employee.id}`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to hire", "error");
      setLoading(false);
    }
  }

  const selectedPrice = priceForTier(role, tier);

  return (
    <Card className="bg-gradient-to-b from-paper to-paper-deep/30 border-accent/20">
      <div className="space-y-5">
        {personas.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
              Pick a persona
            </p>
            <div className="mt-2 space-y-1.5">
              {personas.map((p) => {
                const active = personaId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPersona(p)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-3 ${
                      active
                        ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                        : "border-rule/30 bg-paper/40 hover:border-rule/60"
                    }`}
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">
                        {p.name}{" "}
                        <span className="text-[10px] font-mono text-ink-mute">
                          · {p.age} · {p.city}
                        </span>
                      </p>
                      <p className="text-[10px] text-ink-mute truncate">
                        {p.dialect} · {p.voice.replace(/_/g, " ")}
                      </p>
                    </div>
                    {active && <Check size={14} className="text-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-rule/40 bg-paper/60 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
            maxLength={64}
          />
        </div>

        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
            Plan
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {TIER_ORDER.map((t) => {
              const active = tier === t;
              const price = priceForTier(role, t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`relative text-left px-3 py-2.5 rounded-xl border transition-all ${
                    active
                      ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                      : "border-rule/30 bg-paper/30 hover:border-rule/60"
                  }`}
                >
                  <p className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                    {TIER_LABELS[t]}
                  </p>
                  <p className="text-sm font-display text-ink mt-0.5">
                    {formatPriceSAR(price)}
                    <span className="text-[9px] font-mono text-ink-mute ml-0.5">SAR</span>
                  </p>
                  {active && (
                    <Check size={12} className="absolute top-2 right-2 text-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-rule/30">
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute mb-2">
            Summary
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">
              {displayName || role.name} — {TIER_LABELS[tier]}
            </span>
            <span className="font-display text-xl text-ink nums">
              {formatPriceSAR(selectedPrice)}
              <span className="text-[10px] font-mono font-normal text-ink-mute ml-1">
                SAR/mo
              </span>
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-accent">
            <Check size={10} />
            {role.trialDays}-day free trial
          </div>
        </div>

        <Button
          onClick={handleHire}
          disabled={loading || !displayName.trim()}
          variant="primary"
          className="w-full"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1.5" />
              Starting trial…
            </>
          ) : (
            <>Start {role.trialDays}-day trial</>
          )}
        </Button>

        <p className="text-[9px] text-ink-mute text-center">
          No card required during trial. Billing starts when trial ends.
        </p>
      </div>
    </Card>
  );
}
