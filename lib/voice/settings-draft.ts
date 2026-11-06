/**
 * The voice settings form's draft and the partial PATCH it sends (SW-41: only the fields the
 * merchant changed; everything else keeps its saved value). Client-safe and pure.
 */
import type { VoiceDialect } from "@/lib/voice/dialect";
import type { VoiceSettings } from "@/lib/voice/types";

export type VoiceSettingsPatch = Partial<{
  dialect: VoiceDialect | null;
  hours: string | null;
  escalation_phone: string | null;
  knowledge: string | null;
}>;

export type VoiceSettingsDraft = { dialect: VoiceDialect | ""; hours: string; escalation_phone: string; knowledge: string };

export function draftFromSettings(s: VoiceSettings): VoiceSettingsDraft {
  return {
    dialect: s.dialect ?? "",
    hours: s.hours ?? "",
    escalation_phone: s.escalation_phone ?? "",
    knowledge: s.knowledge ?? ""
  };
}

/** Only the fields that changed ("" clears a field / returns the dialect to the platform default). */
export function settingsPatch(saved: VoiceSettings, draft: VoiceSettingsDraft): VoiceSettingsPatch {
  const patch: VoiceSettingsPatch = {};
  const before = draftFromSettings(saved);
  if (draft.dialect !== before.dialect) patch.dialect = draft.dialect || null;
  if (draft.hours.trim() !== before.hours.trim()) patch.hours = draft.hours.trim() || null;
  if (draft.escalation_phone.trim() !== before.escalation_phone.trim()) patch.escalation_phone = draft.escalation_phone.trim() || null;
  if (draft.knowledge.trim() !== before.knowledge.trim()) patch.knowledge = draft.knowledge.trim() || null;
  return patch;
}
