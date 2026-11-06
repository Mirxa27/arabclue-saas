import type { NextRequest, NextResponse } from "next/server";
import { handleTwilioVoiceInbound } from "@/lib/voice/twilio-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio voice inbound webhook — verifies X-Twilio-Signature, then returns TwiML that
 * connects the caller to the Realtime bridge for the called number's merchant.
 * Always answers with valid TwiML (errors included); logic: lib/voice/twilio-inbound.ts.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleTwilioVoiceInbound(req);
}
