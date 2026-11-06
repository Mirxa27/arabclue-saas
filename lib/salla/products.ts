/**
 * Salla product catalog access.
 * Normalizes Salla's product shape into our internal `Product` type used by the
 * social agent, SEO engine, and voice agent.
 */
import { sallaApiForMerchant } from "./tokens";
import type { Product } from "@/lib/social/types";

type SallaProductRaw = {
  id: number | string;
  name: string;
  description?: string;
  price?: { amount?: number; currency?: string } | number;
  main_image?: string;
  urls?: { customer?: string };
  categories?: { name?: string }[];
  quantity?: number;
};

type SallaListResponse = {
  data: SallaProductRaw[];
  pagination?: { count: number; total: number; perPage: number; currentPage: number; totalPages: number };
};

function priceOf(p: SallaProductRaw): number {
  if (typeof p.price === "number") return p.price;
  return Number(p.price?.amount ?? 0);
}

export function normalizeProduct(p: SallaProductRaw): Product {
  return {
    id: String(p.id),
    name: p.name,
    description: p.description?.replace(/<[^>]+>/g, "").trim() ?? "",
    price: priceOf(p),
    currency: "SAR",
    category: p.categories?.[0]?.name ?? "general",
    imageUrl: p.main_image,
    url: p.urls?.customer,
    inventory: p.quantity
  };
}

/** Fetch one page of a merchant's products (token resolved and refreshed by lib/salla/tokens.ts). */
export async function fetchProductsPage(merchantId: string, page = 1, perPage = 50) {
  const res = await sallaApiForMerchant<SallaListResponse>(merchantId, `/products?page=${page}&per_page=${perPage}`);
  return {
    products: (res.data ?? []).map(normalizeProduct),
    pagination: res.pagination
  };
}

/** Fetch the merchant's full catalog, paginating until exhausted (capped for safety). */
export async function fetchAllProducts(merchantId: string, maxPages = 20): Promise<Product[]> {
  const all: Product[] = [];
  let page = 1;
  while (page <= maxPages) {
    const { products, pagination } = await fetchProductsPage(merchantId, page);
    all.push(...products);
    if (!pagination || page >= pagination.totalPages) break;
    page += 1;
  }
  return all;
}
