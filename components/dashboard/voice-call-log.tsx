"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Clock, PhoneForwarded, PhoneIncoming, PhoneMissed, PhoneOff, Search } from "lucide-react";
import { Badge, Card, CardSubtitle, CardTitle, Empty } from "@/components/ui/primitives";
import { VOICE_CALL_OUTCOME_TEXT, VOICE_DECLINE_TEXT } from "@/lib/voice/messages";
import type { VoiceCallEntry, VoiceCallOutcome } from "@/lib/voice/types";

const OUTCOME_ICON: Record<VoiceCallOutcome, React.ElementType> = {
  bridged: PhoneIncoming,
  forwarded: PhoneForwarded,
  not_bridged: PhoneOff,
  declined: PhoneMissed
};

const OUTCOME_TONE: Record<VoiceCallOutcome, "success" | "warn" | "danger" | "default"> = {
  bridged: "success",
  forwarded: "default",
  not_bridged: "danger",
  declined: "warn"
};

/** Calls routed to the store's number over the last 30 days (GET /api/voice/calls). */
export function VoiceCallLog({ calls, retentionDays = 30 }: { calls: VoiceCallEntry[]; retentionDays?: number }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.replace(/\s/g, "");
    if (!q) return calls;
    return calls.filter((c) => (c.caller_number ?? "").includes(q));
  }, [calls, search]);

  const answered = calls.filter((c) => c.outcome === "bridged").length;
  const missed = calls.filter((c) => c.outcome === "declined" || c.outcome === "not_bridged").length;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <CardTitle className="font-arabic text-lg md:text-xl">سجل المكالمات · Call log</CardTitle>
          <CardSubtitle className="mt-1">
            <span className="font-arabic">{`آخر ${retentionDays} يوماً — ردّ المساعد على ${answered}، ولم يُرد على ${missed}.`}</span>{" "}
            {`Last ${retentionDays} days — ${answered} answered by the agent, ${missed} not answered.`}
          </CardSubtitle>
        </div>
        <div className="relative w-full md:w-64">
          <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-mute" aria-hidden />
          <input
            type="search"
            dir="ltr"
            inputMode="tel"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="+9665…"
            aria-label="ابحث برقم المتصل · Search by caller number"
            className="h-10 w-full rounded-xl border border-rule/40 bg-paper-deep/30 ps-10 pe-4 text-sm text-ink placeholder:text-ink-mute/50 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-rule/30 p-8">
          <Empty
            title={calls.length === 0 ? "لا توجد مكالمات بعد · No calls yet" : "لا توجد نتائج · No matching calls"}
            hint={
              calls.length === 0
                ? "تظهر هنا المكالمات الواردة على رقم متجرك. · Calls to your store's number appear here."
                : "جرّب رقماً آخر. · Try another number."
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-rule/30 border-t border-rule/30">
          {filtered.map((call) => {
            const Icon = OUTCOME_ICON[call.outcome] ?? PhoneIncoming;
            const outcome = VOICE_CALL_OUTCOME_TEXT[call.outcome];
            const decline = call.decline_reason ? VOICE_DECLINE_TEXT[call.decline_reason] : null;
            return (
              <li key={call.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={16} className="shrink-0 text-ink-mute" aria-hidden />
                  <div className="min-w-0">
                    {call.caller_number ? (
                      <div dir="ltr" className="font-mono text-sm text-ink text-start">
                        {call.caller_number}
                      </div>
                    ) : (
                      <div className="font-arabic text-sm text-ink-soft">رقم مخفي · Hidden number</div>
                    )}
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-mute">
                      <Clock size={11} aria-hidden />
                      <span dir="ltr" className="font-mono">
                        {format(parseISO(call.created_at), "yyyy-MM-dd HH:mm")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <Badge tone={OUTCOME_TONE[call.outcome]}>{outcome.en}</Badge>
                  <span className="font-arabic text-[11px] text-ink-soft">
                    {outcome.ar}
                    {decline ? ` — ${decline.ar} · ${decline.en}` : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
