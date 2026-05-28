import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { buildRealtimeSessionConfig, type VoicePersona } from "@/lib/voice/agent";

export const runtime = "nodejs";

/**
 * Returns an ephemeral OpenAI Realtime client secret + the session config for this merchant.
 * The browser or telephony bridge uses the ephemeral key to open the Realtime connection
 * without ever seeing the long-lived OPENAI_API_KEY.
 */
export async function POST(_req: NextRequest) {
  await requireUser();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data: kit } = await supabase.from("brand_kits").select("*").eq("merchant_id", merchant.id).maybeSingle();
  const { data: vc } = await supabase.from("voice_configs").select("*").eq("merchant_id", merchant.id).maybeSingle();

  const persona: VoicePersona = {
    merchantId: merchant.id,
    storeName: merchant.seller_name ?? kit?.brand_name ?? "المتجر",
    dialect: (vc?.dialect ?? kit?.dialect ?? "khaliji") === "msa" ? "msa" : "khaliji",
    hours: vc?.hours ?? undefined,
    escalationPhone: vc?.escalation_phone ?? undefined,
    knowledge: vc?.knowledge ?? undefined
  };

  const sessionConfig = buildRealtimeSessionConfig(persona);

  // Mint ephemeral session token from OpenAI
  const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview",
      voice: sessionConfig.session.voice,
      modalities: sessionConfig.session.modalities,
      instructions: sessionConfig.session.instructions
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: "realtime session failed", detail: text.slice(0, 200) }, { status: 502 });
  }

  const ephemeral = await res.json();
  return NextResponse.json({ ephemeral, sessionConfig });
}
