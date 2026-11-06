/**
 * POST /api/voice/bridge/session — the Realtime session for one phone call (F22, SW-40).
 *
 * Twilio is the only live voice path: when a call's media stream reaches the bridge, the bridge
 * asks here for the session to open with OpenAI Realtime. This replaces /api/voice/session, which
 * needed a browser session cookie the bridge never has, asked for a retired model on the retired
 * beta endpoint and was not gated. The session is built server-side (GA format, supported model,
 * the merchant's dialect, hours and knowledge) and only for a call routed to this merchant that
 * may still be answered (lib/voice/bridge-context.ts). No OpenAI key or client secret is minted
 * here: the bridge holds its own server credential.
 *
 * Request  (Authorization: Bearer $VOICE_BRIDGE_SECRET)
 *   { "merchantId": uuid, "callSid": "CA…" }       — from the Twilio stream's start message
 * Responses
 *   200 { session, greeting, dialect, maxCallSeconds }  → send { type: "session.update", session }
 *   403 { code: "voice_unavailable", reason }            → end the stream (Twilio hangs up)
 *   404 { code: "unknown_call" } · 400 invalid body / unknown merchant · 401 · 503 secret unset
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { buildRealtimeSession, voiceGreeting, VOICE_MAX_CALL_SECONDS } from "@/lib/voice/agent";
import { authenticateBridge, loadBridgeCallContext } from "@/lib/voice/bridge-context";
import { CALL_SID_RE } from "@/lib/voice/calls";

export const VOICE_BRIDGE_SESSION_ROUTE = "POST /api/voice/bridge/session";
const MAX_BODY_BYTES = 8 * 1024;

export const VoiceBridgeSessionRequestSchema = z.object({
  merchantId: z.uuid(),
  callSid: z.string().regex(CALL_SID_RE)
});

export async function handleVoiceBridgeSession(req: NextRequest): Promise<NextResponse> {
  const denied = authenticateBridge(req);
  if (denied) return denied;

  const raw = await readTextBody(req, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { merchantId, callSid } = VoiceBridgeSessionRequestSchema.parse(json);

  const ctx = await loadBridgeCallContext(getServiceSupabase(), merchantId, callSid);
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.code === "voice_unavailable" ? "voice agent unavailable for this merchant" : ctx.code, code: ctx.code, reason: ctx.reason },
      { status: ctx.status }
    );
  }

  return NextResponse.json({
    session: buildRealtimeSession(ctx.persona),
    greeting: voiceGreeting(ctx.persona.storeName, ctx.persona.dialect),
    dialect: ctx.persona.dialect,
    maxCallSeconds: VOICE_MAX_CALL_SECONDS
  });
}
