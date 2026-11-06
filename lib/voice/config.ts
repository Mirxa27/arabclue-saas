/**
 * Merchant voice settings (GET/PATCH /api/voice/config) and the one write path for the agent's
 * on/off switch (SW-8, SW-21, SW-41, SW-42).
 *
 *  - PATCH is a partial update: only the keys the client sent are written (no defaults), sizes
 *    are bounded (also by the 20261106006000 check constraints) and unknown keys — e.g.
 *    phone_number — are rejected.
 *  - voice_configs.enabled is not writable through the Data API; setVoiceEnabled is the only way
 *    to switch the agent on, after the platform kill switch, the plan/subscription and the media
 *    bridge checks. Switching off is always allowed. The overview persona card (PATCH
 *    /api/agents/status, role voice) uses the same function, so both toggles drive the state the
 *    call path reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import { assertNoDbError } from "@/lib/db/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { VOICE_HOURS_MAX, VOICE_KNOWLEDGE_MAX } from "@/lib/voice/agent";
import { isVoiceDialect, resolveVoiceDialect, VOICE_DIALECTS, type VoiceDialect } from "@/lib/voice/dialect";
import { VoiceApiError } from "@/lib/voice/http";
import { VOICE_ERROR_MESSAGES, type VoiceErrorCode } from "@/lib/voice/messages";
import { normalizePhoneE164 } from "@/lib/voice/phone";
import { getTwilioConfig, getVoiceBridgeConfig } from "@/lib/voice/twilio";
import { PROVISIONING_STALE_SECONDS } from "@/lib/voice/twilio-provisioning";
import type { VoiceAvailability, VoiceLineState, VoiceSettings, VoiceSettingsView, VoiceStateReason } from "@/lib/voice/types";

const ROUTE = "voice/config";

export const VOICE_CONFIG_COLUMNS =
  "merchant_id, enabled, dialect, hours, escalation_phone, knowledge, phone_number, provisioning_started_at, updated_at";

export type VoiceConfigRow = {
  merchant_id: string;
  enabled: boolean | null;
  dialect: string | null;
  hours: string | null;
  escalation_phone: string | null;
  knowledge: string | null;
  phone_number: string | null;
  provisioning_started_at: string | null;
  updated_at: string | null;
};

type EntitlementMerchant = Pick<Merchant, "id" | "plan" | "subscription_status">;

/** "ar · en" — the overview persona card shows the API message as is (agentToggleErrorMessage). */
export function voiceRefusal(status: number, code: VoiceErrorCode): VoiceApiError {
  const text = VOICE_ERROR_MESSAGES[code];
  return new VoiceApiError(status, code, `${text.ar} · ${text.en}`);
}

export async function loadVoiceConfig(sb: SupabaseClient, merchantId: string): Promise<VoiceConfigRow | null> {
  const { data, error } = await sb.from("voice_configs").select(VOICE_CONFIG_COLUMNS).eq("merchant_id", merchantId).maybeSingle();
  if (error) throw new Error(`voice config lookup failed: ${error.message}`);
  return (data as VoiceConfigRow | null) ?? null;
}

/** The brand kit's dialect — the fallback between the merchant's voice choice and the platform default. */
export async function loadBrandDialect(sb: SupabaseClient, merchantId: string): Promise<string | null> {
  const { data, error } = await sb.from("brand_kits").select("dialect").eq("merchant_id", merchantId).maybeSingle();
  if (error) throw new Error(`brand kit lookup failed: ${error.message}`);
  return ((data as { dialect?: string | null } | null)?.dialect ?? null) || null;
}

export async function voiceAvailability(merchant: Pick<Merchant, "plan" | "subscription_status">): Promise<VoiceAvailability> {
  const agents = await getAgentSettings();
  return {
    entitled: merchantCanUseFeature(merchant, "voice"),
    platformEnabled: agents.voice.enabled !== false,
    bridgeConfigured: getVoiceBridgeConfig() !== null,
    twilioConfigured: getTwilioConfig() !== null,
    defaultDialect: resolveVoiceDialect(agents.voice.defaultDialect)
  };
}

export function isProvisioningFresh(startedAt: string | null | undefined, now = Date.now()): boolean {
  if (!startedAt) return false;
  const at = Date.parse(startedAt);
  return Number.isFinite(at) && now - at < PROVISIONING_STALE_SECONDS * 1000;
}

/** What the line does on the next call — the same checks as lib/voice/entitlement.ts, plus setup. */
export function deriveVoiceLineState(
  config: Pick<VoiceConfigRow, "enabled" | "phone_number" | "provisioning_started_at"> | null,
  availability: VoiceAvailability,
  now = Date.now()
): { state: VoiceLineState; reasons: VoiceStateReason[] } {
  const hasNumber = Boolean(config?.phone_number);
  const blocking: VoiceStateReason[] = [];
  if (!availability.platformEnabled) blocking.push("platform_disabled");
  if (!availability.entitled) blocking.push("plan_required");
  if (!availability.bridgeConfigured) blocking.push("bridge_not_configured");
  if (!hasNumber && !availability.twilioConfigured) blocking.push("twilio_not_configured");
  if (blocking.some((r) => r !== "twilio_not_configured")) return { state: "unavailable", reasons: blocking };

  if (config?.enabled !== true) {
    return { state: "paused", reasons: ["agent_off", ...(hasNumber ? [] : (["number_missing"] as VoiceStateReason[])), ...blocking] };
  }
  if (!hasNumber) {
    const waiting: VoiceStateReason = isProvisioningFresh(config.provisioning_started_at, now) ? "provisioning" : "number_missing";
    return { state: "needs_number", reasons: [waiting, ...blocking] };
  }
  return { state: "active", reasons: [] };
}

export function toVoiceSettings(
  config: VoiceConfigRow | null,
  availability: VoiceAvailability,
  brandDialect: string | null = null,
  now = Date.now()
): VoiceSettings {
  const dialect = isVoiceDialect(config?.dialect) ? config.dialect : null;
  return {
    enabled: config?.enabled === true,
    dialect,
    effectiveDialect: resolveVoiceDialect(dialect, brandDialect, availability.defaultDialect),
    hours: config?.hours ?? null,
    escalation_phone: config?.escalation_phone ?? null,
    knowledge: config?.knowledge ?? null,
    phone_number: config?.phone_number ?? null,
    provisioning: isProvisioningFresh(config?.provisioning_started_at, now),
    updated_at: config?.updated_at ?? null
  };
}

export function buildVoiceSettingsView(
  config: VoiceConfigRow | null,
  availability: VoiceAvailability,
  brandDialect: string | null = null,
  now = Date.now()
): VoiceSettingsView {
  const { state, reasons } = deriveVoiceLineState(config, availability, now);
  return {
    config: toVoiceSettings(config, availability, brandDialect, now),
    state,
    reasons,
    availability,
    limits: { hours: VOICE_HOURS_MAX, knowledge: VOICE_KNOWLEDGE_MAX }
  };
}

/** GET /api/voice/config — reads through the merchant's own session (RLS). */
export async function getVoiceSettingsView(sb: SupabaseClient, merchant: EntitlementMerchant): Promise<VoiceSettingsView> {
  const [config, brandDialect, availability] = await Promise.all([
    loadVoiceConfig(sb, merchant.id),
    loadBrandDialect(sb, merchant.id),
    voiceAvailability(merchant)
  ]);
  return buildVoiceSettingsView(config, availability, brandDialect);
}

// ── PATCH ──────────────────────────────────────────────────────────────────────

/** Partial update — absent keys stay as they are; null (or "") clears a text field / the dialect choice. */
export const VoiceConfigPatchSchema = z.strictObject({
  dialect: z.enum(VOICE_DIALECTS).nullable().optional(),
  hours: z.string().trim().max(VOICE_HOURS_MAX).nullable().optional(),
  escalation_phone: z.string().trim().max(32).nullable().optional(),
  knowledge: z.string().trim().max(VOICE_KNOWLEDGE_MAX).nullable().optional(),
  enabled: z.boolean().optional()
});

export type VoiceConfigPatch = z.infer<typeof VoiceConfigPatchSchema>;

/** The voice_configs column values a validated patch writes — exactly the keys it carries. */
export function voiceConfigWrite(patch: VoiceConfigPatch): Record<string, string | boolean | null> {
  const values: Record<string, string | boolean | null> = {};
  if (patch.dialect !== undefined) values.dialect = patch.dialect;
  if (patch.hours !== undefined) values.hours = patch.hours || null;
  if (patch.knowledge !== undefined) values.knowledge = patch.knowledge || null;
  if (patch.escalation_phone !== undefined) {
    if (!patch.escalation_phone) values.escalation_phone = null;
    else {
      const e164 = normalizePhoneE164(patch.escalation_phone);
      if (!e164) throw voiceRefusal(400, "invalid_escalation_phone");
      values.escalation_phone = e164;
    }
  }
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  return values;
}

/**
 * Apply a settings patch for the session's merchant on the service role (scoped by merchant_id).
 * Switching off alone is always allowed; anything else needs the platform switch and the plan,
 * and switching on also needs the media bridge (SW-42: never "on" while calls cannot connect).
 */
export async function patchVoiceConfig(merchant: EntitlementMerchant, input: unknown): Promise<VoiceSettingsView> {
  const patch = VoiceConfigPatchSchema.parse(input);
  const values = voiceConfigWrite(patch);
  const keys = Object.keys(values);
  if (keys.length === 0) throw voiceRefusal(400, "nothing_to_update");

  const availability = await voiceAvailability(merchant);
  const onlySwitchesOff = keys.length === 1 && values.enabled === false;
  if (!onlySwitchesOff) {
    if (!availability.platformEnabled) throw voiceRefusal(503, "voice_platform_disabled");
    if (!availability.entitled) throw voiceRefusal(402, "plan_required");
    if (values.enabled === true && !availability.bridgeConfigured) throw voiceRefusal(503, "voice_bridge_not_configured");
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("voice_configs")
    .upsert({ merchant_id: merchant.id, ...values, updated_at: new Date().toISOString() }, { onConflict: "merchant_id" })
    .select(VOICE_CONFIG_COLUMNS)
    .single();
  assertNoDbError(error, "Save voice settings", { route: ROUTE, merchantId: merchant.id, code: "voice_settings_failed" });

  const brandDialect = await loadBrandDialect(sb, merchant.id);
  return buildVoiceSettingsView(data as VoiceConfigRow, availability, brandDialect);
}

/** The agent's on/off switch (voice page toggle and the overview persona card). */
export async function setVoiceEnabled(merchant: EntitlementMerchant, enabled: boolean): Promise<VoiceSettingsView> {
  return patchVoiceConfig(merchant, { enabled });
}

/** The dialect a call speaks: the merchant's choice, then the brand kit's, then the platform default. */
export function callDialect(voiceDialect: unknown, brandDialect: unknown, platformDefault: unknown): VoiceDialect {
  return resolveVoiceDialect(voiceDialect, brandDialect, platformDefault);
}
