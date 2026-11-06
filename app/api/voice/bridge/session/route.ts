import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { handleVoiceBridgeSession, VOICE_BRIDGE_SESSION_ROUTE } from "@/lib/voice/bridge-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the media bridge when a Twilio call's stream starts: returns the server-built GA
 * Realtime session for that call, or 403 when the call may no longer be answered.
 * Body: { merchantId, callSid }. Auth: `Authorization: Bearer $VOICE_BRIDGE_SECRET` (503 while unset).
 * Logic and contract: lib/voice/bridge-session.ts.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleVoiceBridgeSession(req);
  } catch (err) {
    return handleRouteError(err, { route: VOICE_BRIDGE_SESSION_ROUTE });
  }
}
