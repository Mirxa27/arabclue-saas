/**
 * Publishable media for a post (social_posts.media, SW-12): images from the merchant's own
 * catalog (salla_products.image_url, chosen at planning time) or an image the merchant attached
 * while reviewing. LLM-written URLs are never media. Pure and client-safe.
 */
import { z } from "zod";
import type { PostMedia, Product } from "./types";

export const POST_MEDIA_MAX = 10;

export const HttpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "must be an https:// URL");

export const PostMediaSchema = z.object({
  url: HttpsUrlSchema,
  productId: z.string().trim().min(1).max(128).optional()
});

export const PostMediaListSchema = z.array(PostMediaSchema).max(POST_MEDIA_MAX);

/** Defensive read of a stored media value: drops anything malformed, dedupes, caps the count. */
export function parsePostMedia(value: unknown): PostMedia[] {
  if (!Array.isArray(value)) return [];
  const out: PostMedia[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = PostMediaSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.url)) continue;
    seen.add(parsed.data.url);
    out.push(parsed.data.productId ? { url: parsed.data.url, productId: parsed.data.productId } : { url: parsed.data.url });
    if (out.length >= POST_MEDIA_MAX) break;
  }
  return out;
}

/** Catalog images for the products a planned post references (merchant's own products only). */
export function mediaForProducts(productIds: readonly string[], catalog: ReadonlyMap<string, Product>): PostMedia[] {
  const media: PostMedia[] = [];
  const seen = new Set<string>();
  for (const id of productIds) {
    const url = catalog.get(id)?.imageUrl;
    if (!url || seen.has(url) || !HttpsUrlSchema.safeParse(url).success) continue;
    seen.add(url);
    media.push({ url: url.trim(), productId: id });
    if (media.length >= POST_MEDIA_MAX) break;
  }
  return media;
}
