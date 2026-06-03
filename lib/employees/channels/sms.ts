/**
 * Twilio SMS adapter for AI employees.
 *
 * The merchant supplies their own Twilio Account SID + Auth Token and either a
 * sending number (`from`, E.164) or a Messaging Service SID. Credentials live
 * encrypted in `ai_employee_integrations.credentials`. We call the official REST
 * API directly — no third-party gateway.
 *
 * Inbound: see /app/api/employees/webhooks/sms/[id]/route.ts. Twilio signs every
 * webhook with `X-Twilio-Signature` (HMAC-SHA1 over the full URL + sorted POST
 * params); we verify it with `verifyTwilioSignature` before processing.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type TwilioSmsCredentials = {
  account_sid: string;
  auth_token: string;
  from?: string; // E.164 sender number, e.g. +14155552671
  messaging_service_sid?: string; // alternative to `from`
};

export type TwilioSmsSendResult = { sid: string };

export type TwilioSmsIncoming = {
  from: string;
  to: string;
  messageId: string;
  text: string;
};

export async function sendSms(
  creds: TwilioSmsCredentials,
  to: string,
  body: string
): Promise<TwilioSmsSendResult> {
  if (!creds.account_sid) throw new Error("Twilio SMS: account_sid missing");
  if (!creds.auth_token) throw new Error("Twilio SMS: auth_token missing");
  if (!creds.from && !creds.messaging_service_sid) {
    throw new Error("Twilio SMS: a `from` number or `messaging_service_sid` is required");
  }
  if (!to) throw new Error("Twilio SMS: recipient `to` is required");

  const params = new URLSearchParams({ To: to, Body: body });
  if (creds.messaging_service_sid) params.set("MessagingServiceSid", creds.messaging_service_sid);
  else if (creds.from) params.set("From", creds.from);

  const auth = Buffer.from(`${creds.account_sid}:${creds.auth_token}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.account_sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }
  );

  const json = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
    error_message?: string;
  };
  if (!res.ok || !json.sid) {
    throw new Error(`Twilio SMS send failed: ${json.error_message ?? json.message ?? res.statusText}`);
  }
  return { sid: json.sid };
}

/**
 * Verify Twilio's `X-Twilio-Signature`.
 *
 * Algorithm: HMAC-SHA1(authToken, fullUrl + concat(sortedParamKey + paramValue))
 * encoded as base64. See https://www.twilio.com/docs/usage/security#validating-requests
 * Uses a constant-time comparison to avoid leaking the signature byte-by-byte.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined
): boolean {
  if (!authToken || !signature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Normalises a Twilio inbound SMS webhook (form-encoded) into our shape. */
export function parseTwilioSmsWebhook(form: Record<string, string>): TwilioSmsIncoming | null {
  const from = form.From;
  const to = form.To;
  if (!from || !to) return null;
  return {
    from,
    to,
    messageId: form.MessageSid ?? form.SmsSid ?? "",
    text: form.Body ?? ""
  };
}
