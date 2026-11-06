/**
 * POST /api/voice/webhook — tool calls from the telephony bridge (server-side infra we run).
 *
 * F05: the bridge authenticates with `Authorization: Bearer $VOICE_BRIDGE_SECRET`,
 * compared in constant time. An unset secret refuses every call (503) instead of
 * accepting the literal "Bearer undefined"; the body (merchant id + tool call) is
 * validated with bounds before any merchant data is loaded.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { boundedRecord } from "@/lib/api/zod-bounds";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { hasBearerSecret } from "@/lib/security/compare";
import { dispatchVoiceTool, ToolCallSchema, type VoicePersona, type VoiceToolContext } from "@/lib/voice/agent";

export const VOICE_BRIDGE_ROUTE = "POST /api/voice/webhook";
const MAX_BODY_BYTES = 64 * 1024;

export const VoiceBridgeRequestSchema = z.object({
  merchantId: z.uuid(),
  call: z.object({
    name: ToolCallSchema.shape.name,
    arguments: boundedRecord(20, z.string().max(64), z.unknown())
  })
});

export type VoiceBridgeRequest = z.infer<typeof VoiceBridgeRequestSchema>;

export async function handleVoiceBridgeToolCall(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.VOICE_BRIDGE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "voice bridge not configured", code: "webhook_not_configured" }, { status: 503 });
  }
  if (!hasBearerSecret(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = await readTextBody(req, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { merchantId, call } = VoiceBridgeRequestSchema.parse(json);

  const supabase = getServiceSupabase();
  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .maybeSingle();
  if (merchantErr) throw new Error(`merchant lookup failed: ${merchantErr.message}`);
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

  const { data: vc, error: vcErr } = await supabase
    .from("voice_configs")
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (vcErr) throw new Error(`voice config lookup failed: ${vcErr.message}`);

  const persona: VoicePersona = {
    merchantId,
    storeName: merchant.seller_name ?? "المتجر",
    dialect: (vc?.dialect ?? "khaliji") === "msa" ? "msa" : "khaliji",
    hours: vc?.hours ?? undefined,
    escalationPhone: vc?.escalation_phone ?? undefined,
    knowledge: vc?.knowledge ?? undefined
  };

  const ctx: VoiceToolContext = {
    merchantId,
    accessToken: merchant.access_token,
    persona,
    async recordBooking(b) {
      const { data } = await supabase
        .from("bookings")
        .insert({ merchant_id: merchantId, name: b.name, mobile: b.mobile, preferred_time: b.preferredTime, note: b.note, source: "voice" })
        .select("id")
        .single();
      return (data?.id ?? "—").toString().slice(0, 8);
    },
    async notifyHuman(reason, summary) {
      await supabase.from("events").insert({
        kind: "voice.escalation",
        merchant: merchantId,
        payload: { reason, summary, at: new Date().toISOString() }
      });
    }
  };

  const result = await dispatchVoiceTool(call, ctx);

  await supabase.from("events").insert({
    kind: "voice.tool_call",
    merchant: merchantId,
    payload: { name: call.name, arguments: call.arguments, output: result.output }
  });

  return NextResponse.json(result);
}
