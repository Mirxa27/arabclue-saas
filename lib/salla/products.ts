/**
 * Salla product catalog access.
 * Normalizes Salla's product shape into our internal `Product` type used by the
 * social agent, SEO engine, and voice agent.
 */
import { sallaAPI } from "./oauth";
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

/** Fetch one page of products. */
export async function fetchProductsPage(accessToken: string, page = 1, perPage = 50) {
  const res = await sallaAPI<SallaListResponse>(`/products?page=${page}&per_page=${perPage}`, accessToken);
  return {
    products: (res.data ?? []).map(normalizeProduct),
    pagination: res.pagination
  };
}

/** Fetch the full catalog, paginating until exhausted (capped for safety). */
export async function fetchAllProducts(accessToken: string, maxPages = 20): Promise<Product[]> {
  const all: Product[] = [];
  let page = 1;
  while (page <= maxPages) {
    const { products, pagination } = await fetchProductsPage(accessToken, page);
    all.push(...products);
    if (!pagination || page >= pagination.totalPages) break;
    page += 1;
  }
  return all;
}
