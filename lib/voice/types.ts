/**
 * Response shapes of the merchant-facing voice API (/api/voice/*). Client-safe: the voice page
 * and its components import these; the route handlers build them (lib/voice/config.ts, calls.ts,
 * requests.ts).
 */
import type { VoiceDialect } from "@/lib/voice/dialect";

/** What the phone line does right now, derived from the same checks the call path runs. */
export type VoiceLineState =
  /** calls are answered by the agent */
  | "active"
  /** switched on, but no number yet (or one is being bought) */
  | "needs_number"
  /** the merchant switched the agent off; calls hear "unavailable" */
  | "paused"
  /** the plan, the platform switch or the platform's telephony setup prevents answering */
  | "unavailable";

export type VoiceStateReason =
  | "plan_required"
  | "platform_disabled"
  | "bridge_not_configured"
  | "twilio_not_configured"
  | "number_missing"
  | "provisioning"
  | "agent_off";

export type VoiceAvailability = {
  /** The merchant's plan includes voice and the subscription is active (or in its grace period). */
  entitled: boolean;
  /** platform_settings agents.voice.enabled */
  platformEnabled: boolean;
  /** VOICE_BRIDGE_WS_URL (wss) + VOICE_BRIDGE_SECRET are set: calls can reach the agent */
  bridgeConfigured: boolean;
  /** TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + NEXT_PUBLIC_SITE_URL are set: numbers can be bought */
  twilioConfigured: boolean;
  /** platform default used while the merchant has not chosen a dialect */
  defaultDialect: VoiceDialect;
};

export type VoiceSettings = {
  enabled: boolean;
  /** the merchant's choice; null = the platform default (availability.defaultDialect) */
  dialect: VoiceDialect | null;
  /** the dialect the agent speaks on the next call */
  effectiveDialect: VoiceDialect;
  hours: string | null;
  /** E.164 */
  escalation_phone: string | null;
  knowledge: string | null;
  /** the provisioned Twilio number (server-written), null until one is bought */
  phone_number: string | null;
  /** a purchase is in flight */
  provisioning: boolean;
  updated_at: string | null;
};

export type VoiceSettingsView = {
  config: VoiceSettings;
  state: VoiceLineState;
  reasons: VoiceStateReason[];
  availability: VoiceAvailability;
  limits: { hours: number; knowledge: number };
};

export type VoiceCallOutcome = "bridged" | "forwarded" | "not_bridged" | "declined";
export type VoiceCallDeclineReason = "agent_off" | "plan" | "platform_off";

export type VoiceCallEntry = {
  id: string;
  created_at: string;
  /** E.164 caller id as Twilio reported it; null when withheld */
  caller_number: string | null;
  outcome: VoiceCallOutcome;
  decline_reason: VoiceCallDeclineReason | null;
};

export type VoiceBookingStatus = "new" | "confirmed" | "done" | "canceled";

export type VoiceBookingEntry = {
  id: string;
  name: string;
  mobile: string;
  preferred_time: string | null;
  note: string | null;
  status: VoiceBookingStatus;
  created_at: string;
};

export type VoiceEscalationStatus = "open" | "resolved";

export type VoiceEscalationEntry = {
  id: string;
  reason: string;
  summary: string | null;
  callback_number: string | null;
  status: VoiceEscalationStatus;
  created_at: string;
  resolved_at: string | null;
};
