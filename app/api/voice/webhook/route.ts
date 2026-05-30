import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { dispatchVoiceTool, ToolCallSchema, type VoicePersona, type VoiceToolContext } from "@/lib/voice/agent";

export const runtime = "nodejs";

/**
 * Called by the telephony bridge when the Realtime model emits a function call.
 * Body: { merchantId, call: { name, arguments } }
 * Returns: { output } to be fed back to the model as the tool result.
 *
 * Auth: shared bridge secret (the bridge is server-side infra we control).
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.VOICE_BRIDGE_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const body = await req.json();
  const merchantId = String(body.merchantId ?? "");
  const call = ToolCallSchema.parse(body.call);

  const supabase = getServiceSupabase();
  const { data: merchant } = await supabase.from("merchants").select("*").eq("id", merchantId).maybeSingle();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

  const { data: vc } = await supabase.from("voice_configs").select("*").eq("merchant_id", merchantId).maybeSingle();

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
