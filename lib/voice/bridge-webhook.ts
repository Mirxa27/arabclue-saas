/**
 * POST /api/voice/webhook — tool calls from the telephony bridge (server-side infra we run).
 *
 * F05: the bridge authenticates with `Authorization: Bearer $VOICE_BRIDGE_SECRET`,
 * compared in constant time. An unset secret refuses every call (503) instead of
 * accepting the literal "Bearer undefined"; the body (merchant id + tool call) is
 * validated with bounds before any merchant data is loaded.
 *
 * SW-8: the call-time gate (plan, platform switch, merchant switch) is re-checked per tool call;
 * a refusal answers 403 with a polite `output` and runs nothing.
 * SW-23: `callSid` ties the tool call to a call we routed to this merchant; its verified caller
 * id is what order lookups match on (without it, lookups answer "cannot verify").
 * SW-24: bookings / escalations are only confirmed when saved, and reach the merchant.
 * SW-45: the voice.tool_call event keeps the tool name, the outcome and record ids — no
 * arguments, outputs or caller data.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { boundedRecord } from "@/lib/api/zod-bounds";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { dispatchVoiceTool, ToolCallSchema, voiceLines, type VoiceToolContext, type VoiceToolResult } from "@/lib/voice/agent";
import { authenticateBridge, loadBridgeCallContext } from "@/lib/voice/bridge-context";
import { CALL_SID_RE } from "@/lib/voice/calls";
import { recordVoiceBooking, recordVoiceEscalation } from "@/lib/voice/requests";

export const VOICE_BRIDGE_ROUTE = "POST /api/voice/webhook";
const MAX_BODY_BYTES = 64 * 1024;

export const VoiceBridgeRequestSchema = z.object({
  merchantId: z.uuid(),
  /** Twilio CallSid of the call (start.callSid of the media stream). */
  callSid: z.string().regex(CALL_SID_RE).optional(),
  call: z.object({
    name: ToolCallSchema.shape.name,
    arguments: boundedRecord(20, z.string().max(64), z.unknown())
  })
});

export type VoiceBridgeRequest = z.infer<typeof VoiceBridgeRequestSchema>;

export async function handleVoiceBridgeToolCall(req: NextRequest): Promise<NextResponse> {
  const denied = authenticateBridge(req);
  if (denied) return denied;

  const raw = await readTextBody(req, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { merchantId, callSid, call } = VoiceBridgeRequestSchema.parse(json);

  const supabase = getServiceSupabase();
  const context = await loadBridgeCallContext(supabase, merchantId, callSid ?? null);
  if (!context.ok) {
    if (context.code === "no_merchant") return NextResponse.json({ error: "no merchant", code: context.code }, { status: 400 });
    if (context.code === "unknown_call") return NextResponse.json({ error: "unknown call", code: context.code }, { status: 404 });
    return NextResponse.json(
      { error: "voice agent unavailable for this merchant", code: context.code, reason: context.reason, output: voiceLines("khaliji").unavailable },
      { status: 403 }
    );
  }

  const sid = context.call?.callSid ?? null;
  const ctx: VoiceToolContext = {
    merchantId,
    persona: context.persona,
    callerNumber: context.call?.callerNumber ?? null,
    recordBooking: (booking) => recordVoiceBooking(supabase, { merchantId, callSid: sid, booking }),
    recordEscalation: (escalation) => recordVoiceEscalation(supabase, { merchantId, callSid: sid, escalation })
  };

  let result: VoiceToolResult;
  try {
    result = await dispatchVoiceTool(call, ctx);
  } catch (err) {
    // A failure must still give the caller an honest line, not a 500 the bridge reads as silence.
    reportError(err, { route: VOICE_BRIDGE_ROUTE, merchantId, extra: { tool: call.name } });
    result = { output: voiceLines(context.persona.dialect).genericFailure, outcome: "failed" };
  }

  const { error: eventErr } = await supabase.from("events").insert({
    kind: "voice.tool_call",
    merchant: merchantId,
    payload: {
      name: call.name,
      outcome: result.outcome,
      call_sid: sid,
      ...(result.bookingId ? { booking_id: result.bookingId } : {}),
      ...(result.escalationId ? { escalation_id: result.escalationId } : {})
    }
  });
  if (eventErr) reportError(new Error(`voice.tool_call event: ${eventErr.message}`), { route: VOICE_BRIDGE_ROUTE, merchantId });

  return NextResponse.json({ output: result.output });
}
