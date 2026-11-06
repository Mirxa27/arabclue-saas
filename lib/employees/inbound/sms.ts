/**
 * POST /api/employees/webhooks/sms/[id] — Twilio SMS webhook for one AI employee.
 *
 * Twilio POSTs form-encoded params signed with X-Twilio-Signature (HMAC-SHA1 over
 * the public URL + sorted params, keyed with the Auth Token). The signature is
 * checked before any processing (no auth token: 503; bad signature: 403), the
 * MessageSid is claimed once, the reply runs in after(), and Twilio gets empty TwiML.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { parseTwilioSmsWebhook, type TwilioSmsIncoming } from "@/lib/employees/channels/sms";
import { loadEmployeeIntegration, touchIntegrationLastEvent } from "@/lib/employees/integration-store";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";
import { readTextBody } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { claimInboundEvents, errorText, inboundAckStatus, processClaimedInbound } from "@/lib/webhooks/inbound-claims";
import { parseTwilioForm, TWILIO_FORM_MAX_BYTES, twimlResponse, verifyTwilioRequest } from "@/lib/webhooks/twilio";
import { capInboundText, forbidden, isEmployeeId, logInboundRejected, nonEmptyString, notConfigured } from "./shared";

export const SMS_INBOUND_ROUTE = "POST /api/employees/webhooks/sms/:id";
export const TWILIO_SMS_WEBHOOK_PROVIDER = "twilio_sms";

function emptyTwiml(): NextResponse {
  return twimlResponse("");
}

export async function receiveTwilioSmsWebhook(req: NextRequest, employeeId: string): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "employees:webhook:sms", 180, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;

  const integration = isEmployeeId(employeeId) ? await loadEmployeeIntegration(employeeId, "twilio_sms") : null;
  if (!integration) return NextResponse.json({ error: "no twilio_sms integration" }, { status: 404 });

  const authToken = nonEmptyString(integration.credentials.auth_token);
  if (!authToken) {
    await logInboundRejected(employeeId, "twilio_sms", "no_auth_token");
    return notConfigured("twilio_sms auth_token not configured");
  }

  const params = parseTwilioForm(await readTextBody(req, TWILIO_FORM_MAX_BYTES));
  if (!verifyTwilioRequest(req, authToken, params)) return forbidden("invalid signature");

  const msg = parseTwilioSmsWebhook(params);
  const text = msg?.text ? capInboundText(msg.text) : "";
  if (!msg || !text || !msg.messageId) return emptyTwiml();

  const item: TwilioSmsIncoming = { ...msg, text };
  const summary = await claimInboundEvents(TWILIO_SMS_WEBHOOK_PROVIDER, [{ eventId: msg.messageId, item }]);

  const claimed = summary.claimed;
  after(async () => {
    await processClaimedInbound<TwilioSmsIncoming>({
      provider: TWILIO_SMS_WEBHOOK_PROVIDER,
      route: SMS_INBOUND_ROUTE,
      claimed,
      orderKey: (m) => m.from,
      handle: async (m) => {
        await handleInboundMessage({ employeeId, channel: "twilio_sms", externalId: m.from, text: m.text });
      },
      onFailure: (m, err) =>
        logAction({
          employeeId,
          action: "inbound_message",
          channel: "twilio_sms",
          target: m.from,
          status: "failure",
          result: { messageId: m.messageId, error: errorText(err) }
        })
    });
    if (claimed.length > 0) await touchIntegrationLastEvent([integration.id]);
  });

  const status = inboundAckStatus(summary);
  if (status === 500) {
    reportError(summary.failure, { route: SMS_INBOUND_ROUTE, status, extra: { step: "webhook_claim" } });
    return NextResponse.json({ error: "temporarily unable to record the message" }, { status });
  }
  if (status === 409) return NextResponse.json({ error: "message is being processed" }, { status });
  return emptyTwiml();
}
