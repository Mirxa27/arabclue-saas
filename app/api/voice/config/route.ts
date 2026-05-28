import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";

export const runtime = "nodejs";

const Schema = z.object({
  dialect: z.enum(["khaliji", "msa"]).default("khaliji"),
  hours: z.string().optional(),
  escalation_phone: z.string().optional(),
  knowledge: z.string().optional(),
  enabled: z.boolean().default(false)
});

export async function POST(req: NextRequest) {
  await requireUser();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

  const body = Schema.parse(await req.json());
  const supabase = getServerSupabase();
  await supabase.from("voice_configs").upsert({
    merchant_id: merchant.id,
    ...body,
    updated_at: new Date().toISOString()
  });
  return NextResponse.json({ ok: true });
}
