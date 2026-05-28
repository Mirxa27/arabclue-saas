import { z } from "zod";

export type Platform = "instagram" | "tiktok" | "x" | "snapchat" | "linkedin" | "whatsapp";

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
  date: string; // ISO
  name: string;
  arabicName: string;
  type: "national" | "religious" | "shopping" | "season";
  importance: 1 | 2 | 3; // 3 = highest
};

export const PlannedPostSchema = z.object({
  scheduledFor: z.string().describe("ISO timestamp"),
  platforms: z.array(z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"])),
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

export const VisualBriefSchema = z.object({
  layout: z.enum(["single", "carousel", "reel-cover", "story"]),
  slides: z
    .array(
      z.object({
        kind: z.enum(["hero", "feature", "testimonial", "cta", "lifestyle"]),
        headline: z.string(),
        subhead: z.string().optional(),
        productId: z.string().optional(),
        imageUrl: z.string().url().optional()
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

// Connector contract — implemented in ./connectors.ts, consumed by the scheduler in ./agent.ts
export interface PlatformConnector {
  platform: Platform;
  publish(payload: {
    copy: Copy;
    visualBrief?: VisualBrief;
    productUrl?: string;
    imageUrl?: string;
  }): Promise<{ remoteId: string }>;
}
