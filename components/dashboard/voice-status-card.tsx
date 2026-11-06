"use client";

import Link from "next/link";
import { Mic, MicOff, Phone, PhoneOff, RefreshCw, AlertCircle } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { VOICE_REASON_TEXT, VOICE_STATE_TEXT } from "@/lib/voice/messages";
import type { VoiceSettingsView } from "@/lib/voice/types";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<VoiceSettingsView["state"], "success" | "warn" | "default" | "danger"> = {
  active: "success",
  needs_number: "warn",
  paused: "default",
  unavailable: "danger"
};

/**
 * The phone line at a glance: what the next call does (never "handled" without a number), why,
 * the on/off switch and the number (get / replace). Every claim comes from GET /api/voice/config.
 */
export function VoiceStatusCard({
  view,
  toggling,
  provisioning,
  onToggle,
  onProvision
}: {
  view: VoiceSettingsView;
  toggling: boolean;
  provisioning: boolean;
  onToggle: (next: boolean) => void;
  onProvision: (replace: boolean) => void;
}) {
  const { config, state, reasons, availability } = view;
  const text = VOICE_STATE_TEXT[state];
  const canSwitchOn = availability.entitled && availability.platformEnabled && availability.bridgeConfigured;
  const canBuyNumber = canSwitchOn && availability.twilioConfigured && !config.provisioning;
  const live = state === "active";

  return (
    <Card>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
              live ? "border-success/30 bg-success/10 text-success" : "border-rule/30 bg-ink/5 text-ink-mute"
            )}
          >
            {live ? <Mic size={22} aria-hidden /> : <MicOff size={22} aria-hidden />}
          </div>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-arabic text-lg font-semibold text-ink">{text.title.ar}</h2>
              <Badge tone={STATE_TONE[state]} dot animate={live}>
                {text.title.en}
              </Badge>
            </div>
            <p className="font-arabic text-sm text-ink-soft">{text.body.ar}</p>
            <p className="text-xs text-ink-mute">{text.body.en}</p>
            {reasons.length > 0 && (
              <ul className="mt-2 space-y-1.5" aria-label="أسباب · Reasons">
                {reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2 text-xs">
                    <AlertCircle size={13} className="mt-0.5 shrink-0 text-accent-warm" aria-hidden />
                    <span>
                      <span className="font-arabic text-ink-soft">{VOICE_REASON_TEXT[reason].ar}</span>{" "}
                      <span className="text-ink-mute">· {VOICE_REASON_TEXT[reason].en}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {reasons.includes("plan_required") && (
              <Link href="/billing" className="inline-block pt-1 text-xs font-medium text-accent underline-offset-4 hover:underline">
                عرض الباقات · See plans
              </Link>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
          <Button
            variant={config.enabled ? "outline" : "primary"}
            onClick={() => onToggle(!config.enabled)}
            disabled={toggling || (!config.enabled && !canSwitchOn)}
            aria-pressed={config.enabled}
          >
            {config.enabled ? <MicOff size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
            {config.enabled ? "إيقاف · Pause" : "تشغيل · Switch on"}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-rule/30 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {config.phone_number ? <Phone size={16} className="text-accent" aria-hidden /> : <PhoneOff size={16} className="text-ink-mute" aria-hidden />}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">رقم المتجر · Store number</div>
            {config.phone_number ? (
              <div dir="ltr" className="font-mono text-sm text-ink">
                {config.phone_number}
              </div>
            ) : (
              <div className="font-arabic text-sm text-ink-soft">
                {config.provisioning ? "جارٍ الشراء… · Being bought…" : "لا يوجد رقم بعد · No number yet"}
              </div>
            )}
          </div>
        </div>
        {config.phone_number ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={provisioning || !canBuyNumber}
            onClick={() => {
              if (window.confirm("سيُلغى الرقم الحالي نهائياً ويُشترى رقم جديد. متابعة؟\nThe current number is released for good and a new one is bought. Continue?")) {
                onProvision(true);
              }
            }}
          >
            <RefreshCw size={13} aria-hidden />
            استبدال الرقم · Replace number
          </Button>
        ) : (
          <Button size="sm" disabled={provisioning || !canBuyNumber} onClick={() => onProvision(false)}>
            <Phone size={13} aria-hidden />
            {provisioning ? "جارٍ الشراء… · Buying…" : "احصل على رقم · Get a number"}
          </Button>
        )}
      </div>
    </Card>
  );
}
