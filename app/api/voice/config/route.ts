import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { getAgentSettings } from "@/lib/admin/platform-settings";

export const runtime = "nodejs";

const Schema = z.object({
  dialect: z.enum(["khaliji", "msa"]).default("khaliji"),
  hours: z.string().optional(),
  escalation_phone: z.string().optional(),
  knowledge: z.string().optional(),
  enabled: z.boolean().default(false)
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const agents = await getAgentSettings();
    if (!agents.voice.enabled) {
      return NextResponse.json({ error: "Voice agent is disabled platform-wide" }, { status: 503 });
    }
    if (!merchantCanUseFeature(merchant, "voice")) {
      return NextResponse.json({ error: featureGateMessage("voice") }, { status: 402 });
    }

    const body = Schema.parse(await req.json());
    const supabase = await getServerSupabase();
    const { error } = await supabase.from("voice_configs").upsert({
      merchant_id: merchant.id,
      ...body,
      updated_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
