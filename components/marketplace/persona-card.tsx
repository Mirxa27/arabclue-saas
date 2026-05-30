import type { Persona } from "@/lib/employees/personas";

export function PersonaCard({ persona }: { persona: Persona }) {
  return (
    <div className="rounded-2xl border border-rule/30 bg-paper/50 p-4 flex gap-3">
      <div className="w-12 h-12 rounded-xl bg-paper-deep/50 border border-rule/30 flex items-center justify-center text-2xl shrink-0">
        {persona.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="font-display text-base text-ink truncate">{persona.name}</p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
            {persona.age}y · {persona.nationality} · {persona.city}
          </p>
        </div>
        <p className="text-[11px] text-ink-mute font-arabic mt-0.5" dir="rtl">
          {persona.arabicName}
        </p>
        <p className="mt-2 text-xs text-ink-soft leading-relaxed line-clamp-3">
          {persona.background}
        </p>
        <p className="mt-2 text-[10px] font-mono uppercase tracking-widest text-accent">
          {persona.dialect} · {persona.voice.replace(/_/g, " ")}
        </p>
      </div>
    </div>
  );
}
