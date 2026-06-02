export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";

const Schema = z.object({
  brand_name: z.string().min(1),
  essence: z.string().optional().default(""),
  attributes: z.array(z.string()).default([]),
  favor_words: z.array(z.string()).default([]),
  avoid_words: z.array(z.string()).default([]),
  dialect: z.enum(["khaliji", "msa", "english"]).default("khaliji")
});

export async function POST(req: NextRequest) {
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const body = Schema.parse(await req.json());
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("brand_kits")
    .upsert({ ...body, merchant_id: merchant.id, updated_at: new Date().toISOString() }, { onConflict: "merchant_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ kit: null });
  const supabase = await getServerSupabase();
  const { data } = await supabase.from("brand_kits").select("*").eq("merchant_id", merchant.id).maybeSingle();
  return NextResponse.json({ kit: data });
}
