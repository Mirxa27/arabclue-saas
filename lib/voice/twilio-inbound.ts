/**
 * POST /api/voice/twilio/inbound — Twilio voice webhook for platform-provisioned numbers.
 *
 * F24: X-Twilio-Signature is verified with TWILIO_AUTH_TOKEN (the platform account
 * that owns the numbers, lib/voice/twilio.ts) before any DB work, so nobody but
 * Twilio can read a merchant id / bridge URL out of the TwiML or write call events.
 * Every outcome is valid TwiML: 403 for a bad signature, 503 when the token is not
 * configured (fail closed), and an Arabic apology if something breaks mid-call.
 * Twilio retries of the same CallSid get the same TwiML but log one event.
 */
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "@/lib/api/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { runWebhookOnce } from "@/lib/webhooks/idempotency";
import { escapeXml, parseTwilioForm, TWILIO_FORM_MAX_BYTES, twimlResponse, verifyTwilioRequest } from "@/lib/webhooks/twilio";

export const TWILIO_VOICE_ROUTE = "POST /api/voice/twilio/inbound";
export const TWILIO_VOICE_PROVIDER = "twilio_voice";

const UNAVAILABLE = `<Say language="ar-SA">عذراً، هذا الرقم غير متاح حالياً.</Say><Hangup/>`;
const APOLOGY = `<Say language="ar-SA">عذراً، حدث خلل مؤقت. يرجى المحاولة لاحقاً.</Say><Hangup/>`;

async function recordInboundCall(merchantId: string, params: Record<string, string>, called: string): Promise<void> {
  const sb = getServiceSupabase();
  const insert = async () => {
    const { error } = await sb.from("events").insert({
      kind: "voice.inbound_call",
      merchant: merchantId,
      payload: { from: params.From ?? "unknown", to: called, call_sid: params.CallSid ?? null, at: new Date().toISOString() }
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
      return twimlResponse(UNAVAILABLE, 503);
    }

    const params = parseTwilioForm(await readTextBody(req, TWILIO_FORM_MAX_BYTES));
    if (!verifyTwilioRequest(req, authToken, params)) return twimlResponse("<Reject/>", 403);

    const called = params.Called || params.To || "";
    if (!called) return twimlResponse(UNAVAILABLE);

    const supabase = getServiceSupabase();
    const { data: config, error } = await supabase
      .from("voice_configs")
      .select("merchant_id, enabled")
      .eq("phone_number", called)
      .maybeSingle();
    if (error) throw new Error(`voice_configs lookup failed: ${error.message}`);
    if (!config?.enabled) return twimlResponse(UNAVAILABLE);

    await recordInboundCall(config.merchant_id as string, params, called);

    const bridgeUrl = process.env.VOICE_BRIDGE_WS_URL?.trim();
    if (bridgeUrl) {
      return twimlResponse(
        `<Connect><Stream url="${escapeXml(bridgeUrl)}"><Parameter name="merchantId" value="${escapeXml(String(config.merchant_id))}"/></Stream></Connect>`
      );
    }
    return twimlResponse(`<Say language="ar-SA">مرحباً بك. سيتم الرد عليك قريباً.</Say><Pause length="1"/><Hangup/>`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 413) return twimlResponse("<Reject/>", 413);
    reportError(err, { route: TWILIO_VOICE_ROUTE, status: 500 });
    return twimlResponse(APOLOGY);
  }
}
