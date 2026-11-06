/**
 * POST /api/voice/twilio/inbound — Twilio voice webhook for platform-provisioned numbers.
 *
 * F24: X-Twilio-Signature is verified with TWILIO_AUTH_TOKEN (the platform account
 * that owns the numbers, lib/voice/twilio.ts) before any DB work, so nobody but
 * Twilio can read a merchant id / bridge URL out of the TwiML or write call events.
 * Every outcome is valid TwiML: 403 for a bad signature, 503 when the token is not
 * configured (fail closed), and an Arabic apology if something breaks mid-call.
 *
 * SW-8: a call is only bridged to the agent when voiceCallDecision allows it — platform kill
 * switch, plan + subscription, and the merchant's own switch — checked on every call, before
 * anything is logged or streamed. Declined calls hear "unavailable" (the merchant's call log
 * records them; no platform event).
 * SW-42: without a media bridge the caller is never told they will be answered: the call is
 * forwarded to the store's escalation phone when there is one, otherwise the caller hears
 * that the service is unavailable — and the fault is reported.
 * SW-45: the platform event keeps a masked caller number; the full caller id lives only in the
 * merchant's voice_calls log (30-day retention). Twilio retries of a CallSid log once.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { HttpError } from "@/lib/api/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { runWebhookOnce } from "@/lib/webhooks/idempotency";
import { escapeXml, parseTwilioForm, TWILIO_FORM_MAX_BYTES, twimlResponse, verifyTwilioRequest } from "@/lib/webhooks/twilio";
import { recordVoiceCall } from "@/lib/voice/calls";
import { voiceCallDecision } from "@/lib/voice/entitlement";
import { isE164, maskPhone } from "@/lib/voice/phone";
import { getVoiceBridgeConfig } from "@/lib/voice/twilio";
import type { VoiceCallOutcome } from "@/lib/voice/types";
import type { Merchant } from "@/lib/types/database";

export const TWILIO_VOICE_ROUTE = "POST /api/voice/twilio/inbound";
export const TWILIO_VOICE_PROVIDER = "twilio_voice";

export const UNAVAILABLE_TWIML = `<Say language="ar-SA">عذراً، هذا الرقم غير متاح حالياً.</Say><Hangup/>`;
export const NO_SERVICE_TWIML = `<Say language="ar-SA">عذراً، الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً.</Say><Hangup/>`;
const APOLOGY = `<Say language="ar-SA">عذراً، حدث خلل مؤقت. يرجى المحاولة لاحقاً.</Say><Hangup/>`;
const FORWARDING = `<Say language="ar-SA">لحظة من فضلك، جارٍ تحويل مكالمتك إلى فريق المتجر.</Say>`;

/** Minimised platform log of a routed call (SW-45): masked caller, never the full number. */
async function logInboundEvent(
  sb: SupabaseClient,
  merchantId: string,
  params: Record<string, string>,
  outcome: VoiceCallOutcome
): Promise<void> {
  const insert = async () => {
    const { error } = await sb.from("events").insert({
      kind: "voice.inbound_call",
      merchant: merchantId,
      payload: { caller: maskPhone(params.From), call_sid: params.CallSid ?? null, outcome, at: new Date().toISOString() }
    });
    if (error) throw new Error(`voice.inbound_call insert failed: ${error.message}`);
  };
  try {
    if (params.CallSid) await runWebhookOnce(sb, TWILIO_VOICE_PROVIDER, params.CallSid, insert);
    else await insert();
  } catch (err) {
    // The call must still connect: the event log is not worth dropping the caller for.
    reportError(err, { route: TWILIO_VOICE_ROUTE, merchantId });
  }
}

type RoutedConfig = { merchant_id: string; enabled: boolean | null; escalation_phone: string | null };

export async function handleTwilioVoiceInbound(req: NextRequest): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "voice:twilio:inbound", 120, 60_000);
    if (limited instanceof NextResponse) return twimlResponse("<Reject/>", 429);

    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) {
      reportError(new Error("TWILIO_AUTH_TOKEN is not configured; refusing unsigned voice webhooks"), {
        route: TWILIO_VOICE_ROUTE,
        status: 503
      });
      return twimlResponse(UNAVAILABLE_TWIML, 503);
    }

    const params = parseTwilioForm(await readTextBody(req, TWILIO_FORM_MAX_BYTES));
    if (!verifyTwilioRequest(req, authToken, params)) return twimlResponse("<Reject/>", 403);

    const called = params.Called || params.To || "";
    if (!called) return twimlResponse(UNAVAILABLE_TWIML);

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("voice_configs")
      .select("merchant_id, enabled, escalation_phone")
      .eq("phone_number", called)
      .maybeSingle();
    if (error) throw new Error(`voice_configs lookup failed: ${error.message}`);
    const config = data as RoutedConfig | null;
    if (!config) return twimlResponse(UNAVAILABLE_TWIML);
    const merchantId = String(config.merchant_id);

    const [{ data: merchantRow, error: merchantErr }, agents] = await Promise.all([
      supabase.from("merchants").select("plan, subscription_status").eq("id", merchantId).maybeSingle(),
      getAgentSettings()
    ]);
    if (merchantErr) throw new Error(`merchant lookup failed: ${merchantErr.message}`);

    const decision = voiceCallDecision({
      merchant: merchantRow as Pick<Merchant, "plan" | "subscription_status"> | null,
      agentEnabled: config.enabled,
      platformEnabled: agents.voice.enabled !== false
    });
    const callSid = params.CallSid ?? "";
    if (!decision.allowed) {
      await recordVoiceCall(
        supabase,
        { merchantId, callSid, from: params.From, outcome: "declined", declineReason: decision.reason },
        TWILIO_VOICE_ROUTE
      );
      return twimlResponse(UNAVAILABLE_TWIML);
    }

    const bridge = getVoiceBridgeConfig();
    if (!bridge) {
      reportError(new Error("Voice media bridge not configured (VOICE_BRIDGE_WS_URL, VOICE_BRIDGE_SECRET); inbound call not bridged"), {
        route: TWILIO_VOICE_ROUTE,
        merchantId
      });
      const forwardTo = isE164(config.escalation_phone) ? config.escalation_phone : null;
      const outcome: VoiceCallOutcome = forwardTo ? "forwarded" : "not_bridged";
      await recordVoiceCall(supabase, { merchantId, callSid, from: params.From, outcome }, TWILIO_VOICE_ROUTE);
      await logInboundEvent(supabase, merchantId, params, outcome);
      return twimlResponse(forwardTo ? `${FORWARDING}<Dial timeout="25">${escapeXml(forwardTo)}</Dial>` : NO_SERVICE_TWIML);
    }

    await recordVoiceCall(supabase, { merchantId, callSid, from: params.From, outcome: "bridged" }, TWILIO_VOICE_ROUTE);
    await logInboundEvent(supabase, merchantId, params, "bridged");
    return twimlResponse(
      `<Connect><Stream url="${escapeXml(bridge.wsUrl)}"><Parameter name="merchantId" value="${escapeXml(merchantId)}"/></Stream></Connect>`
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 413) return twimlResponse("<Reject/>", 413);
    reportError(err, { route: TWILIO_VOICE_ROUTE, status: 500 });
    return twimlResponse(APOLOGY);
  }
}
