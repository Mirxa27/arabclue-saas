import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { sallaAPI } from "@/lib/salla/oauth";
import { handleRouteError } from "@/lib/api/route-handler";
import { SallaProductsResponseSchema } from "@/lib/types/salla";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_req: NextRequest) {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant?.access_token) {
      return NextResponse.json({ error: "salla not connected" }, { status: 400 });
    }

    const supabase = getServerSupabase();
    let page = 1;
    let totalSynced = 0;
    const limit = 50;

    while (page <= 20) {
      const resp = await sallaAPI<unknown>(`/products?per_page=${limit}&page=${page}`, merchant.access_token);
      const parsed = SallaProductsResponseSchema.parse(resp);
      const items = parsed.data ?? [];
      if (items.length === 0) break;

      const rows = items.map((p) => {
        const price =
          typeof p.price === "number"
            ? p.price
            : typeof p.price === "object" && p.price && "amount" in p.price
              ? Number(p.price.amount ?? 0)
              : 0;
        return {
          merchant_id: merchant.id,
          salla_product_id: String(p.id),
          name: p.name,
          arabic_name: p.name_ar ?? null,
          description: p.description ?? "",
          price,
          category: p.categories?.[0]?.name ?? "general",
          image_url: p.main_image ?? null,
          url: p.urls?.customer ?? null,
          inventory: p.quantity ?? null,
          updated_at: new Date().toISOString()
        };
      });

      await supabase.from("salla_products").upsert(rows, { onConflict: "merchant_id,salla_product_id" });
      totalSynced += rows.length;

      if (items.length < limit) break;
      page++;
    }

    return NextResponse.json({ ok: true, synced: totalSynced });
  } catch (err) {
    return handleRouteError(err);
  }
}
