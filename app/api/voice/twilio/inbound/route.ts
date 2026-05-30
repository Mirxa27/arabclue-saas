import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

/**
 * Twilio voice inbound webhook — returns TwiML to connect caller to Realtime bridge.
 * The telephony bridge reads merchant from the called number mapping.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const called = String(form.get("Called") ?? form.get("To") ?? "");
  const caller = String(form.get("From") ?? "unknown");

  const supabase = getServiceSupabase();
  const { data: config } = await supabase
    .from("voice_configs")
    .select("merchant_id, enabled")
    .eq("phone_number", called)
    .maybeSingle();

  if (!config?.enabled) {
    return twiml(
      `<Say language="ar-SA">عذراً، هذا الرقم غير متاح حالياً.</Say><Hangup/>`
    );
  }

  await supabase.from("events").insert({
    kind: "voice.inbound_call",
    merchant: config.merchant_id,
    payload: { from: caller, to: called, at: new Date().toISOString() }
  });

  const bridgeUrl = process.env.VOICE_BRIDGE_WS_URL;
  if (bridgeUrl) {
    return twiml(
      `<Connect><Stream url="${escapeXml(bridgeUrl)}"><Parameter name="merchantId" value="${config.merchant_id}"/></Stream></Connect>`
    );
  }

  return twiml(
    `<Say language="ar-SA">مرحباً بك. سيتم الرد عليك قريباً.</Say><Pause length="1"/><Hangup/>`
  );
}

function twiml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" }
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
