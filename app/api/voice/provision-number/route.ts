import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { getTwilioConfig, provisionVoiceNumber, releaseVoiceNumber } from "@/lib/voice/twilio";

export const runtime = "nodejs";

const BodySchema = z.object({
  replace: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return jsonError("no merchant", 400);

    const agents = await getAgentSettings();
    if (!agents.voice.enabled) return jsonError("Voice agent is disabled platform-wide", 503);
    if (!merchantCanUseFeature(merchant, "voice")) {
      return jsonError(featureGateMessage("voice"), 402);
    }

    const twilio = getTwilioConfig();
    if (!twilio) {
      return jsonError("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)", 503);
    }

    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const supabase = getServiceSupabase();
    const { data: existing } = await supabase
      .from("voice_configs")
      .select("phone_number, twilio_incoming_sid")
      .eq("merchant_id", merchant.id)
      .maybeSingle();

    if (existing?.phone_number && !body.replace) {
      return NextResponse.json({
        ok: true,
        phoneNumber: existing.phone_number,
        alreadyProvisioned: true
      });
    }

    if (existing?.twilio_incoming_sid && body.replace) {
      await releaseVoiceNumber(twilio, existing.twilio_incoming_sid).catch(() => undefined);
    }

    const { sid, phoneNumber } = await provisionVoiceNumber(twilio);

    const { error } = await supabase.from("voice_configs").upsert({
      merchant_id: merchant.id,
      phone_number: phoneNumber,
      twilio_incoming_sid: sid,
      enabled: true,
      updated_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);

    await supabase.from("events").insert({
      kind: "voice.number_provisioned",
      merchant: merchant.id,
      payload: { phoneNumber, sid }
    });

    return NextResponse.json({ ok: true, phoneNumber, sid });
  } catch (err) {
    return handleRouteError(err);
  }
}
