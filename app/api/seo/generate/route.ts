import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { generateProductCopy, generateBlogPost } from "@/lib/seo/copywriter";
import { handleRouteError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import type { Product } from "@/lib/social/types";
import type { SallaProduct } from "@/lib/types/database";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("product"),
    productId: z.string(),
    dialect: z.enum(["khaliji", "msa", "english"]).optional()
  }),
  z.object({
    kind: z.literal("blog"),
    topic: z.string().min(3),
    primaryKeyword: z.string().min(2),
    audience: z.string().optional(),
    dialect: z.enum(["khaliji", "msa", "english"]).optional()
  })
]);

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const agents = await getAgentSettings();
    if (!agents.seo.enabled) {
      return NextResponse.json({ error: "SEO agent is disabled platform-wide" }, { status: 503 });
    }
    if (!merchantCanUseFeature(merchant, "seo")) {
      return NextResponse.json({ error: featureGateMessage("seo") }, { status: 402 });
    }

    const body = RequestSchema.parse(await req.json());
    const supabase = await getServerSupabase();

    if (body.kind === "product") {
      const { data: row } = await supabase
        .from("salla_products")
        .select("*")
        .eq("merchant_id", merchant.id)
        .eq("salla_product_id", body.productId)
        .maybeSingle();
      if (!row) return NextResponse.json({ error: "product not found" }, { status: 404 });

      const productRow = row as SallaProduct;
      const product: Product = {
        id: productRow.salla_product_id,
        name: productRow.name,
        arabicName: productRow.arabic_name ?? undefined,
        description: productRow.description ?? "",
        price: Number(productRow.price ?? 0),
        currency: "SAR",
        category: productRow.category ?? "general",
        imageUrl: productRow.image_url ?? undefined,
        url: productRow.url ?? undefined
      };

      const copy = await generateProductCopy({ product, dialect: body.dialect, brandName: merchant.seller_name ?? undefined });
      await supabase.from("seo_content").insert({
        merchant_id: merchant.id,
        kind: "product",
        ref_id: body.productId,
        payload: copy
      });
      return NextResponse.json({ ok: true, copy });
    }

    const post = await generateBlogPost({
      topic: body.topic,
      primaryKeyword: body.primaryKeyword,
      audience: body.audience,
      dialect: body.dialect
    });
    await supabase.from("seo_content").insert({
      merchant_id: merchant.id,
      kind: "blog",
      ref_id: post.slug,
      payload: post
    });
    return NextResponse.json({ ok: true, post });
  } catch (err) {
    return handleRouteError(err);
  }
}
