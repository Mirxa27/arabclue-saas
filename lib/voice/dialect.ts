/**
 * Speaking dialects of the voice agent (SW-40). Client-safe: no server imports.
 *
 * voice_configs.dialect is the merchant's choice; NULL means "use the platform default"
 * (platform_settings agents.voice.defaultDialect, editable in /admin/agents). The brand kit's
 * dialect is the next fallback when the merchant has not chosen one for the phone line.
 */

export const VOICE_DIALECTS = ["khaliji", "msa", "english"] as const;
export type VoiceDialect = (typeof VOICE_DIALECTS)[number];

export const FALLBACK_VOICE_DIALECT: VoiceDialect = "khaliji";

export function isVoiceDialect(value: unknown): value is VoiceDialect {
  return typeof value === "string" && (VOICE_DIALECTS as readonly string[]).includes(value);
}

/** The first valid dialect among `candidates` (merchant choice, brand kit, admin default), else khaliji. */
export function resolveVoiceDialect(...candidates: unknown[]): VoiceDialect {
  for (const candidate of candidates) if (isVoiceDialect(candidate)) return candidate;
  return FALLBACK_VOICE_DIALECT;
}

export const VOICE_DIALECT_LABELS: Record<VoiceDialect, { ar: string; en: string }> = {
  khaliji: { ar: "لهجة سعودية خليجية", en: "Saudi / Gulf Arabic" },
  msa: { ar: "العربية الفصحى", en: "Modern Standard Arabic" },
  english: { ar: "الإنجليزية", en: "English" }
};
