/**
 * The merchant's call log (public.voice_calls, 20261106006000_voice_agent.sql).
 *
 * One row per call Twilio routed to a merchant's number, written by the inbound webhook with the
 * caller id Twilio reported. It is (a) the call list on the voice page (UI-005), (b) how the
 * bridge's tool calls prove which call — and so which verified caller — they belong to (SW-23)
 * and (c) the callback number of an escalation. Kept 30 days (prune_voice_records).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/error-reporter";
import { isE164 } from "@/lib/voice/phone";
import type { VoiceCallDeclineReason, VoiceCallEntry, VoiceCallOutcome } from "@/lib/voice/types";

/** Twilio Call SID ("CA" + 32 hex in production). */
export const CALL_SID_RE = /^CA[0-9A-Za-z_-]{1,62}$/;
/** A bridge may refer to a call for this long after Twilio routed it (Realtime sessions end at 60 min). */
export const CALL_REFERENCE_WINDOW_MS = 2 * 60 * 60_000;

export const MAX_CALLS_PAGE = 200;
export const DEFAULT_CALLS_PAGE = 50;

const CALL_COLUMNS = "id, created_at, caller_number, outcome, decline_reason";

export type RecordCallInput = {
  merchantId: string;
  callSid: string;
  /** Twilio `From`; anything that is not E.164 (withheld, "anonymous") is stored as null. */
  from: string | null | undefined;
  outcome: VoiceCallOutcome;
  declineReason?: VoiceCallDeclineReason;
};

/**
 * One row per CallSid. A Twilio retry of the webhook updates it, so the row always matches the
 * TwiML Twilio last executed (the bridge's session/tool requests are checked against it).
 * Never throws: the call must still be answered.
 */
export async function recordVoiceCall(sb: SupabaseClient, input: RecordCallInput, route: string): Promise<boolean> {
  if (!CALL_SID_RE.test(input.callSid)) return false;
  try {
    const { error } = await sb.from("voice_calls").upsert(
      {
        merchant_id: input.merchantId,
        call_sid: input.callSid,
        caller_number: isE164(input.from) ? input.from : null,
        outcome: input.outcome,
        decline_reason: input.outcome === "declined" ? input.declineReason ?? "agent_off" : null
      },
      { onConflict: "call_sid" }
    );
    if (error) throw new Error(`voice_calls insert failed: ${error.message}`);
    return true;
  } catch (err) {
    reportError(err, { route, merchantId: input.merchantId });
    return false;
  }
}

export type BridgedCall = { callSid: string; callerNumber: string | null };

/**
 * The call a bridge request names: routed to THIS merchant, connected to the agent, recently.
 * Null when there is no such call (unknown SID, another merchant's call, declined, too old).
 */
export async function findBridgedCall(
  sb: SupabaseClient,
  merchantId: string,
  callSid: string,
  now = Date.now()
): Promise<BridgedCall | null> {
  if (!CALL_SID_RE.test(callSid)) return null;
  const { data, error } = await sb
    .from("voice_calls")
    .select("merchant_id, caller_number, outcome, created_at")
    .eq("call_sid", callSid)
    .maybeSingle();
  if (error) throw new Error(`voice call lookup failed: ${error.message}`);
  const row = data as { merchant_id: string; caller_number: string | null; outcome: string; created_at: string } | null;
  if (!row || row.merchant_id !== merchantId || row.outcome !== "bridged") return null;
  const at = Date.parse(row.created_at);
  if (!Number.isFinite(at) || now - at > CALL_REFERENCE_WINDOW_MS) return null;
  return { callSid, callerNumber: isE164(row.caller_number) ? row.caller_number : null };
}

export function parseCallsLimit(raw: string | null): number {
  const n = raw === null ? DEFAULT_CALLS_PAGE : Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_CALLS_PAGE;
  return Math.min(n, MAX_CALLS_PAGE);
}

/** Newest calls first, through the merchant's own session (RLS: voice_calls_select_own). */
export async function listVoiceCalls(sb: SupabaseClient, merchantId: string, limit: number): Promise<VoiceCallEntry[]> {
  const { data, error } = await sb
    .from("voice_calls")
    .select(CALL_COLUMNS)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), MAX_CALLS_PAGE));
  if (error) throw new Error(`voice calls lookup failed: ${error.message}`);
  return ((data ?? []) as VoiceCallEntry[]).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    caller_number: row.caller_number ?? null,
    outcome: row.outcome,
    decline_reason: row.decline_reason ?? null
  }));
}
