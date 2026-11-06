/**
 * May the voice agent answer for this merchant right now? (SW-8, SW-21)
 *
 * One predicate for every place a call is handled — the Twilio inbound webhook, the bridge's
 * session request and every tool call — so a plan downgrade, an unpaid subscription, the admin
 * kill switch (platform_settings agents.voice.enabled) or the merchant's own off switch
 * (voice_configs.enabled) takes effect on the next call, not only on the settings page.
 *
 * Not gated on merchants.uninstalled_at: tools that need Salla answer "store not connected"
 * instead (lib/voice/agent.ts), and an uninstalled store's number is released after the grace
 * period (lib/voice/number-release.ts). Pure and client-safe.
 */
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import type { Merchant } from "@/lib/types/database";

export type VoiceGateMerchant = Pick<Merchant, "plan" | "subscription_status">;

/** Why a call is declined, in check order. */
export type VoiceDeclineReason = "platform_off" | "plan" | "agent_off";

export type VoiceCallDecision = { allowed: true } | { allowed: false; reason: VoiceDeclineReason };

export function voiceCallDecision(args: {
  merchant: VoiceGateMerchant | null | undefined;
  /** voice_configs.enabled — the merchant's own switch (overview persona card and the voice page). */
  agentEnabled: boolean | null | undefined;
  /** platform_settings agents.voice.enabled */
  platformEnabled: boolean;
}): VoiceCallDecision {
  if (!args.platformEnabled) return { allowed: false, reason: "platform_off" };
  if (!args.merchant || !merchantCanUseFeature(args.merchant, "voice")) return { allowed: false, reason: "plan" };
  if (args.agentEnabled !== true) return { allowed: false, reason: "agent_off" };
  return { allowed: true };
}

export function voiceCallAllowed(
  merchant: VoiceGateMerchant | null | undefined,
  voiceConfig: { enabled?: boolean | null } | null | undefined,
  agents: { voice: { enabled: boolean } }
): boolean {
  return voiceCallDecision({ merchant, agentEnabled: voiceConfig?.enabled, platformEnabled: agents.voice.enabled }).allowed;
}
