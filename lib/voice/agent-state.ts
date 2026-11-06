/**
 * The voice persona (سالم) on the dashboard overview is the phone line (SW-21).
 *
 * Its on/off is voice_configs.enabled — the flag the call path reads — not agent_settings: the
 * overview card (PATCH /api/agents/status, role voice) and the voice page toggle both go through
 * setVoiceEnabled, with the same gates. Its status is derived from what the next call would do:
 *   active       switched on, number provisioned, plan + platform + media bridge ready
 *   configuring  switched on, no number yet (nothing answers until one is bought)
 *   paused       switched on, but the plan / platform switch / bridge prevents answering
 *                (lastError says why)
 *   idle         switched off
 * agent_settings keeps only the persona overrides (display name, avatar, tone…) for voice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoDbError } from "@/lib/db/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import {
  AGENT_SETTING_COLUMNS,
  buildAgentEntry,
  sanitizeOverrides,
  type AgentEntry,
  type AgentPatch,
  type AgentSettingRow
} from "@/lib/agents/settings";
import type { AgentStatus } from "@/lib/agents/store";
import type { Merchant } from "@/lib/types/database";
import { deriveVoiceLineState, loadVoiceConfig, setVoiceEnabled, voiceAvailability } from "@/lib/voice/config";
import { VOICE_REASON_TEXT } from "@/lib/voice/messages";
import type { VoiceLineState, VoiceStateReason } from "@/lib/voice/types";

export type VoiceAgentLiveState = { enabled: boolean; status: AgentStatus; lastError: string | null };

export function voiceAgentStatus(enabled: boolean, state: VoiceLineState, reasons: readonly VoiceStateReason[]): VoiceAgentLiveState {
  switch (state) {
    case "active":
      return { enabled: true, status: "active", lastError: null };
    case "needs_number":
      return { enabled: true, status: "configuring", lastError: null };
    case "paused":
      return { enabled: false, status: "idle", lastError: null };
    case "unavailable": {
      if (!enabled) return { enabled: false, status: "idle", lastError: null };
      const reason = reasons.find((r) => r !== "twilio_not_configured") ?? reasons[0];
      const text = reason ? VOICE_REASON_TEXT[reason] : null;
      return { enabled: true, status: "paused", lastError: text ? `${text.ar} · ${text.en}` : null };
    }
  }
}

/** The voice card's live state. `sb` may be the merchant's own session (RLS) or the service role. */
export async function voiceAgentState(sb: SupabaseClient, merchantId: string): Promise<VoiceAgentLiveState> {
  const [{ data: merchant, error }, config] = await Promise.all([
    sb.from("merchants").select("plan, subscription_status").eq("id", merchantId).maybeSingle(),
    loadVoiceConfig(sb, merchantId)
  ]);
  if (error) throw new Error(`merchant lookup failed: ${error.message}`);
  const entitlement = (merchant as Pick<Merchant, "plan" | "subscription_status"> | null) ?? {
    plan: "lite" as const,
    subscription_status: "pending" as const
  };
  const availability = await voiceAvailability(entitlement);
  const { state, reasons } = deriveVoiceLineState(config, availability);
  return voiceAgentStatus(config?.enabled === true, state, reasons);
}

/** The on/off a persona PATCH asks for: `enabled`, else what its `status` implies. */
function requestedSwitch(patch: AgentPatch): boolean | undefined {
  if (patch.enabled !== undefined) return patch.enabled;
  if (patch.status === "active") return true;
  if (patch.status === "idle" || patch.status === "paused") return false;
  return undefined;
}

/** PATCH /api/agents/status for role voice. Gate refusals throw coded HttpErrors (402 / 503). */
export async function applyVoiceAgentPatch(merchant: Merchant, patch: AgentPatch): Promise<AgentEntry> {
  const wanted = requestedSwitch(patch);
  if (wanted !== undefined) await setVoiceEnabled(merchant, wanted);

  const sb = getServiceSupabase();
  let row: AgentSettingRow | null = null;
  if (patch.overrides) {
    const { data: existing, error: readErr } = await sb
      .from("agent_settings")
      .select(AGENT_SETTING_COLUMNS)
      .eq("merchant_id", merchant.id)
      .eq("persona_role", "voice")
      .maybeSingle();
    assertNoDbError(readErr, "Load agent settings", { merchantId: merchant.id, route: "agents/status" });
    const overrides = { ...sanitizeOverrides((existing as AgentSettingRow | null)?.overrides), ...patch.overrides };
    const { data, error } = await sb
      .from("agent_settings")
      .upsert({ merchant_id: merchant.id, persona_role: "voice", overrides }, { onConflict: "merchant_id,persona_role" })
      .select(AGENT_SETTING_COLUMNS)
      .single();
    assertNoDbError(error, "Save agent settings", { merchantId: merchant.id, route: "agents/status" });
    row = data as AgentSettingRow;
  } else {
    const { data, error } = await sb
      .from("agent_settings")
      .select(AGENT_SETTING_COLUMNS)
      .eq("merchant_id", merchant.id)
      .eq("persona_role", "voice")
      .maybeSingle();
    assertNoDbError(error, "Load agent settings", { merchantId: merchant.id, route: "agents/status" });
    row = (data as AgentSettingRow | null) ?? null;
  }

  return { ...buildAgentEntry("voice", row), ...(await voiceAgentState(sb, merchant.id)) };
}
