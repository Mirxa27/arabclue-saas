/**
 * GET /api/seo — what the SEO page needs to show the generator (UI-014): the merchant's
 * generated content (newest first, bounded), their synced products to pick from, this
 * month's generation usage, and whether the plan / platform switch allow generating.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import { assertNoDbError } from "@/lib/db/errors";
import { SEO_CONTENT_COLUMNS, seoMonthlyLimit, type SeoUsage } from "@/lib/seo/generate";
import { readUsage, riyadhMonthStart } from "@/lib/usage/counters";
import type { Merchant, SeoContent } from "@/lib/types/database";

export const SEO_LIST_LIMIT = 50;
export const SEO_PRODUCT_LIMIT = 100;

export type SeoProductOption = { id: string; name: string };

export type SeoOverview = {
  items: SeoContent[];
  products: SeoProductOption[];
  usage: SeoUsage;
  /** The merchant's plan includes the SEO module and the subscription is active. */
  entitled: boolean;
  /** The platform admin's SEO agent switch (agents.seo.enabled). */
  agent_enabled: boolean;
};

export async function loadSeoOverview(args: {
  merchant: Pick<Merchant, "id" | "plan" | "subscription_status">;
  agentEnabled: boolean;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  now?: Date;
}): Promise<SeoOverview> {
  const { merchant } = args;
  const periodStart = riyadhMonthStart(args.now);
  const [content, products, used] = await Promise.all([
    args.userClient
      .from("seo_content")
      .select(SEO_CONTENT_COLUMNS)
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .limit(SEO_LIST_LIMIT),
    args.userClient
      .from("salla_products")
      .select("salla_product_id, name, arabic_name")
      .eq("merchant_id", merchant.id)
      .order("updated_at", { ascending: false })
      .limit(SEO_PRODUCT_LIMIT),
    readUsage(args.serviceClient, { merchantId: merchant.id, metric: "seo.generation", periodStart })
  ]);
  const ctx = { route: "GET /api/seo", merchantId: merchant.id, code: "db_read_failed" };
  assertNoDbError(content.error, "Load SEO content", ctx);
  assertNoDbError(products.error, "Load products", ctx);

  const productRows = (products.data ?? []) as Array<{ salla_product_id: string; name: string | null; arabic_name: string | null }>;
  return {
    items: (content.data ?? []) as unknown as SeoContent[],
    products: productRows.map((p) => ({
      id: p.salla_product_id,
      name: (p.arabic_name || p.name || p.salla_product_id).slice(0, 200)
    })),
    usage: { used, limit: seoMonthlyLimit(merchant.plan), period_start: periodStart },
    entitled: merchantCanUseFeature(merchant, "seo"),
    agent_enabled: args.agentEnabled
  };
}
