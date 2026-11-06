/**
 * Per-platform captions (SW-30): what the merchant reviews is exactly what each platform
 * publishes. Every platform's caption is shown and edited separately; nothing is applied to
 * one platform silently. Pure and client-safe (the post drawer uses the same limits).
 */
import { LINKEDIN_COMMENTARY_MAX, toLittleText } from "@/lib/linkedin/api";
import { X_MAX_WEIGHTED_LENGTH, xWeightedLength } from "@/lib/x/text";
import type { Platform } from "./types";

export const CAPTION_LIMITS: Partial<Record<Platform, number>> = {
  x: X_MAX_WEIGHTED_LENGTH,
  instagram: 2200,
  linkedin: LINKEDIN_COMMENTARY_MAX
};

/** Length as the platform counts it: X weighted length, LinkedIn's escaped commentary, code points. */
export function captionLength(platform: Platform, caption: string): number {
  const text = caption.trim();
  if (platform === "x") return xWeightedLength(text);
  if (platform === "linkedin") return toLittleText(text).length;
  return [...text].length;
}

export function captionOverLimit(platform: Platform, caption: string): boolean {
  const limit = CAPTION_LIMITS[platform];
  return limit !== undefined && captionLength(platform, caption) > limit;
}

/** The stored caption for a platform (legacy rows used `body`). */
export function captionFor(copies: unknown, platform: Platform): string {
  if (!copies || typeof copies !== "object") return "";
  const copy = (copies as Record<string, unknown>)[platform];
  if (!copy || typeof copy !== "object") return "";
  const c = copy as Record<string, unknown>;
  return typeof c.caption === "string" ? c.caption : typeof c.body === "string" ? c.body : "";
}

/**
 * Merge edited captions into the stored copies — one entry per edited platform, other copy
 * fields (altText, cta, hashtags) kept. Platforms the post does not target are rejected.
 */
export function applyCaptionEdits(
  copies: unknown,
  platforms: readonly Platform[],
  captions: Partial<Record<Platform, string>>
): Record<string, unknown> {
  const base: Record<string, unknown> =
    copies && typeof copies === "object" && !Array.isArray(copies) ? { ...(copies as Record<string, unknown>) } : {};
  for (const [platform, caption] of Object.entries(captions) as Array<[Platform, string | undefined]>) {
    if (caption === undefined) continue;
    if (!platforms.includes(platform)) throw new Error(`This post does not target ${platform}`);
    const existing = base[platform];
    const fields = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
    base[platform] = { ...fields, caption };
  }
  return base;
}
