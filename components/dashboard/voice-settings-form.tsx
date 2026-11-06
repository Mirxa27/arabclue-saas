"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Card, CardSubtitle, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { VOICE_DIALECT_LABELS, VOICE_DIALECTS } from "@/lib/voice/dialect";
import {
  draftFromSettings as fromSettings,
  settingsPatch,
  type VoiceSettingsDraft as Draft,
  type VoiceSettingsPatch
} from "@/lib/voice/settings-draft";
import type { VoiceAvailability, VoiceSettings } from "@/lib/voice/types";

const selectClass =
  "w-full bg-paper/45 backdrop-blur-sm border border-rule/70 px-4 py-3 text-sm rounded-xl focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/15 disabled:opacity-50";

/** Dialect, hours, hand-over number and store knowledge the agent uses on every call. */
export function VoiceSettingsForm({
  settings,
  availability,
  limits,
  disabled,
  saving,
  onSave
}: {
  settings: VoiceSettings;
  availability: VoiceAvailability;
  limits: { hours: number; knowledge: number };
  disabled: boolean;
  saving: boolean;
  onSave: (patch: VoiceSettingsPatch) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromSettings(settings));
  useEffect(() => setDraft(fromSettings(settings)), [settings]);

  const patch = useMemo(() => settingsPatch(settings, draft), [settings, draft]);
  const dirty = Object.keys(patch).length > 0;
  const defaultLabel = VOICE_DIALECT_LABELS[availability.defaultDialect];
  const speaking = VOICE_DIALECT_LABELS[settings.effectiveDialect];

  return (
    <Card>
      <div className="mb-5">
        <CardTitle className="font-arabic text-lg md:text-xl">إعدادات المساعد · Agent settings</CardTitle>
        <CardSubtitle className="mt-1">
          <span className="font-arabic">يستخدمها سالم في كل مكالمة.</span> Salem uses these on every call.
        </CardSubtitle>
      </div>

      <form
        className="grid gap-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) onSave(patch);
        }}
      >
        <Field
          label="اللهجة · Dialect"
          hint={`يتحدث الآن: ${speaking.ar} · Speaking now: ${speaking.en}`}
        >
          <select
            className={selectClass}
            value={draft.dialect}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, dialect: e.target.value as Draft["dialect"] }))}
          >
            <option value="">{`افتراضي المنصّة (${defaultLabel.ar}) · Platform default (${defaultLabel.en})`}</option>
            {VOICE_DIALECTS.map((d) => (
              <option key={d} value={d}>
                {`${VOICE_DIALECT_LABELS[d].ar} · ${VOICE_DIALECT_LABELS[d].en}`}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="رقم التحويل للفريق · Hand-over number"
          hint="يعطيه المساعد للمتصل عند الحاجة، وتُحوَّل إليه المكالمات إذا تعطّلت الخدمة. · Given to callers when needed; calls are forwarded to it if the service is down."
        >
          <Input
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+9665XXXXXXXX"
            value={draft.escalation_phone}
            disabled={disabled}
            maxLength={32}
            onChange={(e) => setDraft((d) => ({ ...d, escalation_phone: e.target.value }))}
          />
        </Field>

        <div className="md:col-span-2">
          <Field label="ساعات العمل · Business hours" hint={`${draft.hours.length}/${limits.hours}`}>
            <Input
              dir="auto"
              placeholder="٩ صباحاً – ١١ مساءً، السبت إلى الخميس"
              value={draft.hours}
              disabled={disabled}
              maxLength={limits.hours}
              onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))}
            />
          </Field>
        </div>

        <div className="md:col-span-2">
          <Field
            label="معلومات المتجر · Store knowledge"
            hint={`سياسة الاسترجاع، مناطق التوصيل، الأسئلة الشائعة… · Return policy, delivery areas, FAQs… (${draft.knowledge.length}/${limits.knowledge})`}
          >
            <Textarea
              dir="auto"
              rows={6}
              value={draft.knowledge}
              disabled={disabled}
              maxLength={limits.knowledge}
              onChange={(e) => setDraft((d) => ({ ...d, knowledge: e.target.value }))}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 md:col-span-2">
          {dirty && !saving && <span className="text-xs text-ink-mute">تغييرات غير محفوظة · Unsaved changes</span>}
          <Button type="submit" disabled={disabled || saving || !dirty}>
            <Save size={14} aria-hidden />
            {saving ? "جارٍ الحفظ… · Saving…" : "حفظ · Save"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
