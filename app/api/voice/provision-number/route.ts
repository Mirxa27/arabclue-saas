import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import { voiceRefusal } from "@/lib/voice/config";
import { voiceRouteError } from "@/lib/voice/http";
import { getTwilioConfig, getVoiceBridgeConfig } from "@/lib/voice/twilio";
import { provisionMerchantVoiceNumber } from "@/lib/voice/twilio-provisioning";
import { rateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const ROUTE = "POST /api/voice/provision-number";

const BodySchema = z.strictObject({
  replace: z.boolean().optional()
});

/**
 * Buy (or replace) the merchant's Twilio number. Each purchase is billed to the
 * platform's Twilio account, so it is reserved atomically in the database (409 while
 * another request holds the reservation), capped per merchant per day (429), and
 * burst-limited per merchant regardless of IP.
 *
 * SW-42: nothing is bought unless calls can reach the agent — Twilio AND the media bridge
 * (VOICE_BRIDGE_WS_URL + VOICE_BRIDGE_SECRET) must be configured (503 with a stable code
 * the voice page explains). Refusals answer `{ error, code }`.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();

    const agents = await getAgentSettings();
    if (!agents.voice.enabled) throw voiceRefusal(503, "voice_platform_disabled");
    if (!merchantCanUseFeature(merchant, "voice")) throw voiceRefusal(402, "plan_required");

    const twilio = getTwilioConfig();
    if (!twilio) throw voiceRefusal(503, "twilio_not_configured");
    if (!getVoiceBridgeConfig()) throw voiceRefusal(503, "voice_bridge_not_configured");

    const burst = await rateLimit(`voice:provision-number:${merchant.id}`, 5, 60 * 60_000);
    if (!burst.success) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly.", code: "rate_limited" },
        { status: 429, headers: rateLimitHeaders(burst) }
      );
    }

    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const result = await provisionMerchantVoiceNumber(getServiceSupabase(), twilio, merchant.id, {
      replace: body.replace ?? false
    });

    if (result.status === "already_provisioned") {
      return NextResponse.json({ ok: true, phoneNumber: result.phoneNumber, alreadyProvisioned: true });
    }
    return NextResponse.json({ ok: true, phoneNumber: result.phoneNumber, sid: result.sid, replaced: result.replaced });
  } catch (err) {
    return voiceRouteError(err, ROUTE);
  }
}
