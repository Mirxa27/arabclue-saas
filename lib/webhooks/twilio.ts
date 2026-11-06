/**
 * Twilio webhook request helpers shared by the SMS (per employee) and voice
 * (platform number) webhooks.
 *
 * Twilio signs X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted
 * key/value pairs)) over the exact public URL it was configured with
 * (https://www.twilio.com/docs/usage/security#validating-requests).
 */
import { NextResponse } from "next/server";
import { verifyTwilioSignature } from "@/lib/employees/channels/sms";
import { publicUrlCandidates } from "@/lib/http/public-url";

/** Twilio's webhook params are a few KB at most. */
export const TWILIO_FORM_MAX_BYTES = 64 * 1024;

/** Form fields exactly as Twilio sent them (the last value wins for a repeated key). */
export function parseTwilioForm(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  return params;
}

/** True when the signature matches any public URL Twilio may have been configured with. */
export function verifyTwilioRequest(req: Request, authToken: string, params: Record<string, string>): boolean {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;
  return publicUrlCandidates(req).some((url) => verifyTwilioSignature(authToken, url, params, signature));
}

export function twimlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" }
  });
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
