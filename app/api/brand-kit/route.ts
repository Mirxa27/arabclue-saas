export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { assertNoDbError } from "@/lib/db/errors";

const Schema = z.object({
  brand_name: z.string().trim().min(1).max(200),
  // Kits saved before this schema can hold a NULL essence; the page sends it back as-is.
  essence: z
    .string()
    .max(1000)
    .nullish()
    .transform((v) => v ?? ""),
  attributes: z.array(z.string().max(60)).max(20).default([]),
  favor_words: z.array(z.string().max(60)).max(50).default([]),
  avoid_words: z.array(z.string().max(60)).max(50).default([]),
  dialect: z.enum(["khaliji", "msa", "english"]).default("khaliji")
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
    const body = Schema.parse(await req.json());
    const supabase = await getServerSupabase();
    // One kit per merchant: brand_kits_merchant_id_key (20261106001000) backs this conflict target.
    const { error } = await supabase
      .from("brand_kits")
      .upsert({ ...body, merchant_id: merchant.id, updated_at: new Date().toISOString() }, { onConflict: "merchant_id" });
    assertNoDbError(error, "Save brand kit", { merchantId: merchant.id, route: "POST /api/brand-kit" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/brand-kit" });
  }
}

export async function GET() {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ kit: null });
    const supabase = await getServerSupabase();
    const { data } = await supabase.from("brand_kits").select("*").eq("merchant_id", merchant.id).maybeSingle();
    return NextResponse.json({ kit: data });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/brand-kit" });
  }
}
