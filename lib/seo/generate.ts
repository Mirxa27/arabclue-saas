/**
 * POST /api/seo/generate behind the route's auth, switch, plan and rate-limit checks (SW-25).
 *
 * Order matters for spend: the model/residency choice is resolved (503 if it cannot be
 * honoured) and the product is loaded (404) BEFORE a unit of the merchant's monthly quota
 * is claimed; the unit is given back when the model call fails. The quota lives in a
 * service-role counter (lib/usage/counters.ts), so deleting generated content does not
 * restore it. The save is checked: a failed insert answers ok:false / saved:false with the
 * generated copy, never a bare ok:true.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import type { AgentSettings } from "@/lib/admin/types";
import { SEO_MONTHLY_GENERATIONS } from "@/lib/billing/plans";
import { reportError } from "@/lib/observability/error-reporter";
import {
  BLOG_INPUT_LIMITS,
  generateBlogPost,
  generateProductCopy,
  type BlogPost,
  type ProductCopy
} from "@/lib/seo/copywriter";
import { resolveSeoModel } from "@/lib/seo/model";
import { claimUsage, releaseUsage, riyadhMonthStart } from "@/lib/usage/counters";
import type { Product } from "@/lib/social/types";
import type { Merchant, SallaProduct, SeoContent } from "@/lib/types/database";

const DIALECT = z.enum(["khaliji", "msa", "english"]);

export const SeoGenerateBodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("product"),
    productId: z.string().trim().min(1).max(64),
    dialect: DIALECT.optional()
  }),
  z.object({
    kind: z.literal("blog"),
    topic: z.string().trim().min(3).max(BLOG_INPUT_LIMITS.topic),
    primaryKeyword: z.string().trim().min(2).max(BLOG_INPUT_LIMITS.primaryKeyword),
    audience: z.string().trim().max(BLOG_INPUT_LIMITS.audience).optional(),
    dialect: DIALECT.optional()
  })
]);
export type SeoGenerateBody = z.infer<typeof SeoGenerateBodySchema>;

/** Columns of a seo_content row returned to the dashboard. */
export const SEO_CONTENT_COLUMNS = "id, kind, ref_id, payload, published, created_at";

export type SeoUsage = { used: number; limit: number; period_start: string };

export type SeoGenerateResult =
  | { ok: true; saved: true; item: SeoContent; usage: SeoUsage; copy?: ProductCopy; post?: BlogPost }
  | { ok: false; saved: false; item: null; usage: SeoUsage; error: string; copy?: ProductCopy; post?: BlogPost };

export function seoMonthlyLimit(plan: Merchant["plan"] | null | undefined): number {
  return SEO_MONTHLY_GENERATIONS[plan ?? "lite"] ?? 0;
}

function productFromRow(row: SallaProduct): Product {
  return {
    id: row.salla_product_id,
    name: row.name,
    arabicName: row.arabic_name ?? undefined,
    description: row.description ?? "",
    price: Number(row.price ?? 0),
    currency: "SAR",
    category: row.category ?? "general",
    imageUrl: row.image_url ?? undefined,
    url: row.url ?? undefined
  };
}

const SAVE_FAILED =
  "تم توليد المحتوى لكن تعذّر حفظه — انسخه الآن · The content was generated but could not be saved — copy it now";

export async function generateSeoContent(args: {
  merchant: Pick<Merchant, "id" | "plan" | "seller_name">;
  body: SeoGenerateBody;
  settings: AgentSettings["seo"];
  /** The merchant's RLS-scoped session: reads products, writes seo_content (merchant content). */
  userClient: SupabaseClient;
  /** Service role: the usage counter. */
  serviceClient: SupabaseClient;
  now?: Date;
}): Promise<SeoGenerateResult> {
  const { merchant, body } = args;
  const modelChoice = resolveSeoModel(args.settings);

  let product: Product | null = null;
  if (body.kind === "product") {
    const { data: row, error } = await args.userClient
      .from("salla_products")
      .select("salla_product_id, name, arabic_name, description, price, category, image_url, url")
      .eq("merchant_id", merchant.id)
      .eq("salla_product_id", body.productId)
      .maybeSingle();
    assertNoDbError(error, "Load product", { route: "POST /api/seo/generate", merchantId: merchant.id, code: "db_read_failed" });
    if (!row) throw new HttpError(404, "المنتج غير موجود · Product not found", "product_not_found");
    product = productFromRow(row as SallaProduct);
  }

  const limit = seoMonthlyLimit(merchant.plan);
  const periodStart = riyadhMonthStart(args.now);
  const claim = await claimUsage(args.serviceClient, {
    merchantId: merchant.id,
    metric: "seo.generation",
    periodStart,
    limit
  });
  const usage: SeoUsage = { used: claim.used, limit: claim.limit, period_start: periodStart };
  if (!claim.allowed) {
    throw new HttpError(
      429,
      `استخدمت كل عمليات توليد السيو لهذا الشهر (${limit}) · You have used all ${limit} SEO generations for this month`,
      "seo_quota_exceeded"
    );
  }

  let copy: ProductCopy | undefined;
  let post: BlogPost | undefined;
  try {
    if (product) {
      copy = await generateProductCopy({
        product,
        dialect: body.kind === "product" ? body.dialect : undefined,
        brandName: merchant.seller_name ?? undefined,
        ...modelChoice
      });
    } else if (body.kind === "blog") {
      post = await generateBlogPost({
        topic: body.topic,
        primaryKeyword: body.primaryKeyword,
        audience: body.audience || undefined,
        dialect: body.dialect,
        ...modelChoice
      });
    }
  } catch (err) {
    await releaseUsage(args.serviceClient, { merchantId: merchant.id, metric: "seo.generation", periodStart });
    reportError(err, { route: "POST /api/seo/generate", merchantId: merchant.id });
    throw new HttpError(
      502,
      "تعذّر على مزوّد الذكاء الاصطناعي توليد المحتوى — حاول مرة أخرى · The AI provider could not generate the content — try again",
      "ai_generation_failed"
    );
  }

  const payload = (copy ?? post) as Record<string, unknown>;
  const refId = body.kind === "product" ? body.productId : String(post?.slug ?? "").slice(0, 200) || null;
  const { data: saved, error: saveError } = await args.userClient
    .from("seo_content")
    .insert({ merchant_id: merchant.id, kind: body.kind, ref_id: refId, payload })
    .select(SEO_CONTENT_COLUMNS)
    .single();

  if (saveError || !saved) {
    reportError(new Error(`seo_content insert failed: ${saveError?.message ?? "no row returned"}`), {
      route: "POST /api/seo/generate",
      merchantId: merchant.id
    });
    return { ok: false, saved: false, item: null, usage, error: SAVE_FAILED, copy, post };
  }
  return { ok: true, saved: true, item: saved as unknown as SeoContent, usage, copy, post };
}
