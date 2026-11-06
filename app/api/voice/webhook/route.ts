import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { handleVoiceBridgeToolCall, VOICE_BRIDGE_ROUTE } from "@/lib/voice/bridge-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the telephony bridge when the Realtime model emits a function call.
 * Body: { merchantId, call: { name, arguments } }
 * Returns: { output } to be fed back to the model as the tool result.
 *
 * Auth: `Authorization: Bearer $VOICE_BRIDGE_SECRET` (503 when the secret is unset).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleVoiceBridgeToolCall(req);
  } catch (err) {
    return handleRouteError(err, { route: VOICE_BRIDGE_ROUTE });
  }
}
