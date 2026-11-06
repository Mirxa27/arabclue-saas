/**
 * Mirror a merchant's Salla catalog into public.salla_products (F28).
 * Every write is checked (a failed upsert fails the sync with a 500, never "synced N"), and
 * `synced` counts only rows the database returned as written.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoDbError } from "@/lib/db/errors";
import { SallaProductsResponseSchema, type SallaProduct } from "@/lib/types/salla";

export const SALLA_PRODUCTS_PAGE_SIZE = 50;
export const SALLA_PRODUCTS_MAX_PAGES = 20;

export type SallaProductsSyncResult = {
  synced: number;
  pages: number;
  /** More pages existed than one sync reads (SALLA_PRODUCTS_MAX_PAGES × page size). */
  truncated: boolean;
};

function priceOf(p: SallaProduct): number {
  if (typeof p.price === "number") return p.price;
  if (p.price && typeof p.price === "object" && typeof p.price.amount === "number") return p.price.amount;
  return 0;
}

export function toSallaProductRow(merchantId: string, p: SallaProduct, now = new Date()) {
  return {
    merchant_id: merchantId,
    salla_product_id: String(p.id),
    name: p.name,
    arabic_name: p.name_ar ?? null,
    description: p.description ?? "",
    price: priceOf(p),
    category: p.categories?.[0]?.name ?? "general",
    image_url: p.main_image ?? null,
    url: p.urls?.customer ?? null,
    inventory: p.quantity ?? null,
    updated_at: now.toISOString()
  };
}

export async function syncSallaProducts(args: {
  merchantId: string;
  /** Client that writes salla_products (the merchant's RLS-scoped session in the route). */
  db: SupabaseClient;
  /** One page of GET /products (raw JSON). */
  fetchPage: (page: number, perPage: number) => Promise<unknown>;
  route?: string;
  maxPages?: number;
  perPage?: number;
}): Promise<SallaProductsSyncResult> {
  const perPage = args.perPage ?? SALLA_PRODUCTS_PAGE_SIZE;
  const maxPages = args.maxPages ?? SALLA_PRODUCTS_MAX_PAGES;
  let synced = 0;
  let pages = 0;
  let truncated = false;

  for (let page = 1; page <= maxPages; page++) {
    const parsed = SallaProductsResponseSchema.parse(await args.fetchPage(page, perPage));
    const items = parsed.data ?? [];
    pages = page;
    if (items.length === 0) break;

    // One statement may not touch the same row twice: keep the last copy of a repeated id.
    const rows = [...new Map(items.map((p) => [String(p.id), toSallaProductRow(args.merchantId, p)])).values()];
    const { data, error } = await args.db
      .from("salla_products")
      .upsert(rows, { onConflict: "merchant_id,salla_product_id" })
      .select("salla_product_id");
    assertNoDbError(error, "Sync Salla products", { route: args.route, merchantId: args.merchantId });
    synced += Array.isArray(data) ? data.length : 0;

    const totalPages = parsed.pagination?.totalPages;
    const lastPage = typeof totalPages === "number" ? page >= totalPages : items.length < perPage;
    if (lastPage) break;
    if (page === maxPages) truncated = true;
  }

  return { synced, pages, truncated };
}
