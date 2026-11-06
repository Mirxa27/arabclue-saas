import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { getTwilioConfig } from "@/lib/voice/twilio";
import { provisionMerchantVoiceNumber } from "@/lib/voice/twilio-provisioning";
import { rateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const ROUTE = "POST /api/voice/provision-number";

const BodySchema = z.object({
  replace: z.boolean().optional()
});

/**
 * Buy (or replace) the merchant's Twilio number. Each purchase is billed to the
 * platform's Twilio account, so it is reserved atomically in the database (409 while
 * another request holds the reservation), capped per merchant per day (429), and
 * burst-limited per merchant regardless of IP.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();

    const agents = await getAgentSettings();
    if (!agents.voice.enabled) return jsonError("Voice agent is disabled platform-wide", 503);
    if (!merchantCanUseFeature(merchant, "voice")) {
      return jsonError(featureGateMessage("voice"), 402);
    }

    const twilio = getTwilioConfig();
    if (!twilio) {
      return jsonError("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)", 503);
    }

    const burst = await rateLimit(`voice:provision-number:${merchant.id}`, 5, 60 * 60_000);
    if (!burst.success) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
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
    return handleRouteError(err, { route: ROUTE });
  }
}
