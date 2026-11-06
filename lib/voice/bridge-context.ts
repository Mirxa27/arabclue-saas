/**
 * What every request from the media bridge needs before it may act for a merchant:
 *   1. the bridge's bearer secret (constant-time; 503 while unset — F05);
 *   2. the call it is about, when it names one: routed by us to THIS merchant and connected to
 *      the agent (voice_calls) — that row also carries the caller id Twilio verified (SW-23);
 *   3. the call-time gate (SW-8): platform kill switch, plan + subscription, the merchant's own
 *      switch — re-checked on every request, so a downgrade or "إيقاف" applies mid-call too;
 *   4. the persona of the call in the right dialect (SW-40: merchant choice → brand kit →
 *      platform default).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { hasBearerSecret } from "@/lib/security/compare";
import type { VoicePersona } from "@/lib/voice/agent";
import { findBridgedCall, type BridgedCall } from "@/lib/voice/calls";
import { callDialect, loadBrandDialect, loadVoiceConfig, type VoiceConfigRow } from "@/lib/voice/config";
import { voiceCallDecision, type VoiceDeclineReason } from "@/lib/voice/entitlement";
import { isE164 } from "@/lib/voice/phone";
import type { Merchant } from "@/lib/types/database";

/** 503 while VOICE_BRIDGE_SECRET is unset, 401 for a wrong bearer; null when the bridge is authenticated. */
export function authenticateBridge(req: NextRequest): NextResponse | null {
  const secret = process.env.VOICE_BRIDGE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "voice bridge not configured", code: "webhook_not_configured" }, { status: 503 });
  }
  if (!hasBearerSecret(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

type BridgeMerchant = Pick<Merchant, "id" | "plan" | "subscription_status" | "seller_name"> & {
  salla_store_name?: string | null;
};

export type BridgeCallContext =
  | {
      ok: true;
      merchant: BridgeMerchant;
      voiceConfig: VoiceConfigRow | null;
      call: BridgedCall | null;
      persona: VoicePersona;
    }
  | { ok: false; status: 400 | 403 | 404; code: "no_merchant" | "unknown_call" | "voice_unavailable"; reason?: VoiceDeclineReason };

export async function loadBridgeCallContext(
  sb: SupabaseClient,
  merchantId: string,
  callSid: string | null
): Promise<BridgeCallContext> {
  const { data, error } = await sb
    .from("merchants")
    .select("id, plan, subscription_status, seller_name, salla_store_name")
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw new Error(`merchant lookup failed: ${error.message}`);
  const merchant = data as BridgeMerchant | null;
  if (!merchant) return { ok: false, status: 400, code: "no_merchant" };

  const call = callSid ? await findBridgedCall(sb, merchantId, callSid) : null;
  if (callSid && !call) return { ok: false, status: 404, code: "unknown_call" };

  const [voiceConfig, agents] = await Promise.all([loadVoiceConfig(sb, merchantId), getAgentSettings()]);
  const decision = voiceCallDecision({
    merchant,
    agentEnabled: voiceConfig?.enabled,
    platformEnabled: agents.voice.enabled !== false
  });
  if (!decision.allowed) return { ok: false, status: 403, code: "voice_unavailable", reason: decision.reason };

  const brandDialect = voiceConfig?.dialect ? null : await loadBrandDialect(sb, merchantId);
  const persona: VoicePersona = {
    merchantId,
    storeName: merchant.seller_name?.trim() || merchant.salla_store_name?.trim() || "المتجر",
    dialect: callDialect(voiceConfig?.dialect, brandDialect, agents.voice.defaultDialect),
    hours: voiceConfig?.hours ?? undefined,
    escalationPhone: isE164(voiceConfig?.escalation_phone) ? voiceConfig.escalation_phone : undefined,
    knowledge: voiceConfig?.knowledge ?? undefined
  };
  return { ok: true, merchant, voiceConfig, call, persona };
}
