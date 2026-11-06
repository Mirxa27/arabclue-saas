import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/lib/api/errors";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getVoiceSettingsView, patchVoiceConfig } from "@/lib/voice/config";
import { voiceRouteError, VoiceApiError } from "@/lib/voice/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * GET   /api/voice/config → { config, state, reasons, availability, limits } (lib/voice/types.ts):
 *       the merchant's settings, what the line does on the next call and why, and what the
 *       platform has configured (plan, kill switch, media bridge, Twilio).
 * PATCH /api/voice/config → partial update of { dialect, hours, escalation_phone, knowledge,
 *       enabled }; only the keys sent change. Switching on needs the plan (402), the platform
 *       switch (503 voice_platform_disabled) and the media bridge (503 voice_bridge_not_configured);
 *       switching off always works. Answers { ok: true, ...view }.
 * POST  same as PATCH (kept for older clients — no longer resets omitted fields).
 * Refusals: { error, code } (lib/voice/messages.ts).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    return NextResponse.json(await getVoiceSettingsView(await getServerSupabase(), merchant));
  } catch (err) {
    return voiceRouteError(err, "GET /api/voice/config");
  }
}

async function applyPatch(req: NextRequest): Promise<NextResponse> {
  const merchant = await requireMerchantApi();
  const limited = await enforceRateLimit(req, "voice:config", 30, 60_000, merchant.id);
  if (limited instanceof NextResponse) return limited;

  let body: unknown;
  try {
    body = JSON.parse(await readTextBody(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof HttpError) throw err; // 413 from the size cap
    throw new VoiceApiError(400, "invalid_json", "invalid JSON body");
  }
  const view = await patchVoiceConfig(merchant, body);
  return NextResponse.json({ ok: true, ...view });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    return await applyPatch(req);
  } catch (err) {
    return voiceRouteError(err, "PATCH /api/voice/config");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await applyPatch(req);
  } catch (err) {
    return voiceRouteError(err, "POST /api/voice/config");
  }
}
