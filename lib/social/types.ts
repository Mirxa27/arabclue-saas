import { z } from "zod";

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"] as const;
export type Platform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Platforms arabclue can actually publish to (lib/social/connectors.ts). The others are
 * connectable for inbound messages / identity but refuse to publish with a clear reason:
 *  - tiktok: photo posts must be pulled from a TikTok-verified URL prefix (catalog images live on
 *    the merchant's Salla CDN) and the pipeline has no video assets;
 *  - whatsapp: the Cloud API sends to one recipient at a time; there is no "broadcast" target;
 *  - snapchat: no organic posting API.
 */
export const PUBLISHABLE_PLATFORMS = ["instagram", "x", "linkedin"] as const satisfies readonly Platform[];
export type PublishablePlatform = (typeof PUBLISHABLE_PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function isPublishablePlatform(value: unknown): value is PublishablePlatform {
  return typeof value === "string" && (PUBLISHABLE_PLATFORMS as readonly string[]).includes(value);
}

/** Platforms whose posts must carry an image (Instagram feed posts are image posts). */
export const IMAGE_REQUIRED_PLATFORMS: readonly Platform[] = ["instagram"];

export type Dialect = "khaliji" | "msa" | "english";

export type BrandVoice = {
  /** Brand display name in target language */
  name: string;
  /** Short brand essence — e.g., "premium oud for modern Saudi women" */
  essence: string;
  /** 3-7 voice attributes — e.g., ["confident", "warm", "rooted-in-tradition"] */
  attributes: string[];
  /** Vocabulary to favor */
  favorWords?: string[];
  /** Vocabulary to avoid (haram, off-brand, competitors) */
  avoidWords?: string[];
  /** Default dialect */
  dialect: Dialect;
};

export type Product = {
  id: string;
  name: string;
  arabicName?: string;
  description: string;
  price: number;
  currency: "SAR" | "AED" | "USD";
  category: string;
  imageUrl?: string;
  url?: string;
  inventory?: number;
};

export type SaudiCalendarEvent = {
  /** Calendar day in Asia/Riyadh, YYYY-MM-DD. */
  date: string;
  name: string;
  arabicName: string;
  type: "national" | "religious" | "shopping" | "season";
  importance: 1 | 2 | 3; // 3 = highest
  /** Hijri (Umm al-Qura) dates can move by a day after the official moon sighting. */
  approximate?: boolean;
};

export const PlannedPostSchema = z.object({
  scheduledFor: z.string().describe("ISO 8601 timestamp with the +03:00 offset, inside the allowed window"),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).max(6),
  goal: z.enum(["awareness", "consideration", "conversion", "engagement", "retention"]),
  productIds: z.array(z.string()).describe("Salla product IDs referenced — empty for brand posts"),
  hook: z.string().describe("One-line hook in the chosen dialect"),
  rationale: z.string().describe("Why this post on this day — 1 sentence")
});

export const CopySchema = z.object({
  caption: z.string().describe("The platform-ready caption with hashtags"),
  altText: z.string().describe("Accessibility alt text"),
  cta: z.string().describe("Call-to-action phrase"),
  hashtags: z.array(z.string())
});

/**
 * Layout brief for a designer / image step. Deliberately carries no image URLs: whatever URL an
 * LLM writes is never published. Publishable media is resolved server-side from the merchant's
 * own catalog (social_posts.media).
 */
export const VisualBriefSchema = z.object({
  layout: z.enum(["single", "carousel", "reel-cover", "story"]),
  slides: z
    .array(
      z.object({
        kind: z.enum(["hero", "feature", "testimonial", "cta", "lifestyle"]),
        headline: z.string(),
        subhead: z.string().optional(),
        productId: z.string().optional()
      })
    )
    .max(10),
  paletteCue: z.string().describe("e.g., 'cream + emerald + warm sand'")
});

export const ReplyDecisionSchema = z.object({
  action: z.enum(["reply", "react", "escalate", "ignore"]),
  reply: z.string().optional(),
  reason: z.string()
});

export type PlannedPost = z.infer<typeof PlannedPostSchema>;
export type Copy = z.infer<typeof CopySchema>;
export type VisualBrief = z.infer<typeof VisualBriefSchema>;
export type ReplyDecision = z.infer<typeof ReplyDecisionSchema>;

/** A publishable image: always one of the merchant's own catalog images (or one they attached). */
export type PostMedia = { url: string; productId?: string };

export type PublishPayload = {
  copy: Copy;
  visualBrief?: VisualBrief;
  /** Media resolved from social_posts.media — never from the visual brief. */
  images: readonly PostMedia[];
};

export type PublishReceipt = {
  /** The provider's id for the created post (tweet id, IG media id, LinkedIn share URN). */
  remoteId: string;
};

// Connector contract — implemented in ./connectors.ts, consumed by the scheduler in ./scheduler.ts.
// A connector resolves only once the provider confirmed the post; every failure is a PublishError.
export interface PlatformConnector {
  platform: Platform;
  publish(payload: PublishPayload): Promise<PublishReceipt>;
}
