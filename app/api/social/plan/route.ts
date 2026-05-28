import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { runSocialPipeline } from "@/lib/social/agent";
import { handleRouteError } from "@/lib/api/route-handler";
import type { BrandVoice, Platform, Product } from "@/lib/social/types";
import type { SallaProduct } from "@/lib/types/database";

export const runtime = "nodejs";
export const maxDuration = 300;

const RequestSchema = z.object({
  horizonDays: z.number().min(7).max(60).default(30),
  postsPerWeek: z.number().min(1).max(14).default(5),
  platforms: z.array(z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"])).optional()
});

function toProduct(p: SallaProduct): Product {
  return {
    id: p.salla_product_id,
    name: p.name,
    arabicName: p.arabic_name ?? undefined,
    description: p.description ?? "",
    price: Number(p.price ?? 0),
    currency: "SAR",
    category: p.category ?? "general",
    imageUrl: p.image_url ?? undefined,
    url: p.url ?? undefined
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const body = RequestSchema.parse(await req.json().catch(() => ({})));
    const supabase = getServerSupabase();

    const [{ data: kit }, { data: products }] = await Promise.all([
      supabase.from("brand_kits").select("*").eq("merchant_id", merchant.id).maybeSingle(),
      supabase.from("salla_products").select("*").eq("merchant_id", merchant.id).limit(100)
    ]);

    if (!kit) return NextResponse.json({ error: "brand kit not configured" }, { status: 400 });

    const brand: BrandVoice = {
      name: kit.brand_name,
      essence: kit.essence ?? "",
      attributes: kit.attributes ?? [],
      favorWords: kit.favor_words ?? [],
      avoidWords: kit.avoid_words ?? [],
      dialect: kit.dialect ?? "khaliji"
    };

    const productList: Product[] = ((products ?? []) as SallaProduct[]).map(toProduct);
    const platforms: Platform[] = body.platforms ?? ["instagram", "tiktok", "x"];

    const fleshed = await runSocialPipeline({
      brand,
      products: productList,
      platforms,
      horizonDays: body.horizonDays
    });

    const { data: plan } = await supabase
      .from("social_plans")
      .insert({ merchant_id: merchant.id, horizon_days: body.horizonDays, raw_plan: fleshed.map((f) => f.post) })
      .select()
      .single();

    await supabase.from("social_posts").insert(
      fleshed.map((f) => ({
        merchant_id: merchant.id,
        plan_id: plan?.id,
        scheduled_for: f.post.scheduledFor,
        platforms: f.post.platforms,
        goal: f.post.goal,
        hook: f.post.hook,
        copies: f.copies,
        visual_brief: f.visualBrief,
        status: "scheduled"
      }))
    );

    return NextResponse.json({ ok: true, count: fleshed.length, planId: plan?.id });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET() {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ posts: [] });
    const supabase = getServerSupabase();
    const { data } = await supabase
      .from("social_posts")
      .select("*")
      .eq("merchant_id", merchant.id)
      .order("scheduled_for", { ascending: true })
      .limit(60);
    return NextResponse.json({ posts: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
