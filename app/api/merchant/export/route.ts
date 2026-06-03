export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";

export async function GET() {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const supabase = await getServerSupabase();
    const merchantId = merchant.id;

    const [brandKit, invoices, products, posts, channels, voice, seo] = await Promise.all([
      supabase.from("brand_kits").select("*").eq("merchant_id", merchantId).maybeSingle(),
      supabase.from("invoices").select("id, invoice_number, total, status, created_at, salla_order_id").eq("merchant_id", merchantId),
      supabase.from("salla_products").select("*").eq("merchant_id", merchantId),
      supabase.from("social_posts").select("*").eq("merchant_id", merchantId),
      supabase.from("social_channels").select("platform, external_id, connected_at").eq("merchant_id", merchantId),
      supabase.from("voice_configs").select("*").eq("merchant_id", merchantId).maybeSingle(),
      supabase.from("seo_content").select("*").eq("merchant_id", merchantId)
    ]);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      merchant: {
        id: merchant.id,
        seller_name: merchant.seller_name,
        vat_number: merchant.vat_number,
        cr_number: merchant.cr_number,
        seller_address: merchant.seller_address,
        plan: merchant.plan,
        store_url: merchant.store_url,
        installed_at: merchant.installed_at
      },
      brandKit: brandKit.data,
      invoices: invoices.data ?? [],
      products: products.data ?? [],
      socialPosts: posts.data ?? [],
      socialChannels: channels.data ?? [],
      voiceConfig: voice.data,
      seoContent: seo.data ?? []
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="arabclue-export-${merchantId.slice(0, 8)}.json"`
      }
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
