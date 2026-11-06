import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { listVoiceCalls, parseCallsLimit } from "@/lib/voice/calls";
import { voiceRouteError } from "@/lib/voice/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voice/calls?limit=N → { calls: VoiceCallEntry[], limit } — the merchant's call log,
 * newest first, N between 1 and 200 (default 50). Calls are kept 30 days. Read through the
 * merchant's own session (RLS voice_calls_select_own).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const limit = parseCallsLimit(req.nextUrl.searchParams.get("limit"));
    const calls = await listVoiceCalls(await getServerSupabase(), merchant.id, limit);
    return NextResponse.json({ calls, limit });
  } catch (err) {
    return voiceRouteError(err, "GET /api/voice/calls");
  }
}
