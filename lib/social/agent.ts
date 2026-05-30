/**
 * arabclue social agent system.
 *
 * Five composable agents:
 *   1. planner    — builds a 30-day content grid from catalog + calendar + brand voice
 *   2. copywriter — writes per-platform captions in Khaliji / MSA / English
 *   3. visualist  — produces a layout brief for carousels, stories, reels
 *   4. scheduler  — queues posts to the platform connectors at the right time
 *   5. engager    — replies to incoming DMs / comments in dialect, escalates when needed
 *
 * Each agent is a pure async function that takes typed input and returns typed output.
 * Composition happens in `runSocialPipeline` below. The scheduler/engager have side effects
 * (writes to DB, calls platform APIs); the others are pure planning.
 */
import { aiStructured, aiText } from "@/lib/ai/providers";
import { getPersona } from "@/lib/agents/personas";
import { nextSignificantEvents } from "./calendar";
import {
  CopySchema,
  PlannedPostSchema,
  ReplyDecisionSchema,
  VisualBriefSchema,
  type BrandVoice,
  type Copy,
  type Dialect,
  type PlannedPost,
  type Platform,
  type PlatformConnector,
  type Product,
  type ReplyDecision,
  type VisualBrief
} from "./types";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. PLANNER
// ─────────────────────────────────────────────────────────────────────────────

const PlannerOutputSchema = z.object({
  posts: z.array(PlannedPostSchema).min(8).max(40)
});

export async function planner(input: {
  brand: BrandVoice;
  products: Product[];
  horizon: { startISO: string; days: number };
  platforms: Platform[];
  postsPerWeek?: number;
}): Promise<PlannedPost[]> {
  const events = nextSignificantEvents(new Date(input.horizon.startISO), 6);
  const postsPerWeek = input.postsPerWeek ?? 5;
  const target = Math.round((postsPerWeek * input.horizon.days) / 7);
  const noora = getPersona("social");

  const system = `
${noora.systemPrefix}

You are the planner agent for arabclue, working under Noora — an Arabic-first social media operations layer for Saudi/GCC SMBs.
Your job: build a calendar of social posts that balances product-led conversion, brand storytelling, and
moments from the Saudi cultural calendar.

Rules:
- Respect the brand voice; never break it for engagement bait.
- Cluster intensity around high-importance Saudi calendar events.
- ~60% product/conversion, ~25% brand/storytelling, ~15% engagement/community.
- Do NOT post sales content during the first 10 days of Ramadan or on the morning of Eid.
- Spread platforms; do not blast every post to every channel — pick the right channel per goal.
- Output ${target} planned posts across the ${input.horizon.days}-day horizon.
  `.trim();

  const prompt = `
BRAND
- Name: ${input.brand.name}
- Essence: ${input.brand.essence}
- Attributes: ${input.brand.attributes.join(", ")}
- Default dialect: ${input.brand.dialect}

PLATFORMS ENABLED
${input.platforms.join(", ")}

PRODUCT CATALOG (sample of ${input.products.length})
${input.products.slice(0, 30).map((p) => `- ${p.id} · ${p.name} · ${p.category} · ${p.price} ${p.currency}`).join("\n")}

UPCOMING SAUDI CALENDAR EVENTS
${events.map((e) => `- ${e.date} · ${e.arabicName} (${e.name}) · importance=${e.importance}`).join("\n")}

HORIZON: ${input.horizon.startISO} → ${input.horizon.days} days
  `.trim();

  const result = await aiStructured(PlannerOutputSchema, { system, prompt, temperature: 0.5 });
  return result.posts;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COPYWRITER
// ─────────────────────────────────────────────────────────────────────────────

export async function copywriter(input: {
  post: PlannedPost;
  brand: BrandVoice;
  product?: Product;
  platform: Platform;
  dialect?: Dialect;
}): Promise<Copy> {
  const dialect = input.dialect ?? input.brand.dialect;
  const platformRules: Record<Platform, string> = {
    instagram: "Caption up to 220 words. Use 6-10 niche hashtags. No link in body — say 'link in bio'.",
    tiktok: "Hook in first 8 words. Vertical-video framing. 3-5 hashtags. Conversational.",
    x: "Max 240 chars in Arabic (denser than English). One link allowed. 1-2 hashtags only.",
    snapchat: "Punchy, story-style. Big bold emoji okay. No hashtags.",
    linkedin: "Professional but warm. 80-180 words. 3 hashtags. Saudi business context.",
    whatsapp: "Short, direct, broadcast-list tone. Up to 5 lines. CTA in last line."
  };

  const dialectGuide: Record<Dialect, string> = {
    khaliji: "Write in Saudi Khaliji Arabic — natural, warm, real. Use 'يا اهلين'، 'وش رايكم'، 'حبيت لكم' where they fit. Avoid formal Fusha unless the brand calls for it.",
    msa: "Write in Modern Standard Arabic — clean, classical, dignified.",
    english: "Write in English, but with cultural awareness of Saudi/Gulf context."
  };

  const system = `
You are the copywriter agent for arabclue. Write platform-perfect ${input.platform} copy.

VOICE:
- Brand: ${input.brand.name}
- Essence: ${input.brand.essence}
- Attributes: ${input.brand.attributes.join(", ")}
- Favor: ${(input.brand.favorWords ?? []).join(", ") || "—"}
- Avoid: ${(input.brand.avoidWords ?? []).join(", ") || "—"}

DIALECT: ${dialectGuide[dialect]}

PLATFORM RULES: ${platformRules[input.platform]}

Cultural rules:
- Never use alcohol references, gambling, or sexually suggestive copy.
- During Ramadan: respectful tone, no aggressive selling before iftar.
- Saudi National Day (Sep 23) and Founding Day (Feb 22): patriotic register acceptable but not forced.
  `.trim();

  const prompt = `
POST INTENT
- Goal: ${input.post.goal}
- Hook line: ${input.post.hook}
- Rationale: ${input.post.rationale}
${input.product ? `
PRODUCT
- Name: ${input.product.arabicName ?? input.product.name}
- Description: ${input.product.description}
- Price: ${input.product.price} ${input.product.currency}
- URL: ${input.product.url ?? "(use link in bio)"}
` : "(brand/community post — no specific product)"}
  `.trim();

  return aiStructured(CopySchema, { system, prompt, temperature: 0.7 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. VISUALIST
// ─────────────────────────────────────────────────────────────────────────────

export async function visualist(input: {
  post: PlannedPost;
  brand: BrandVoice;
  product?: Product;
  platform: Platform;
}): Promise<VisualBrief> {
  const system = `
You are the visualist agent. Produce a layout brief for an ${input.platform} post.
Output specifies layout type, ordered slides, and a palette cue that downstream image
generation or a human designer can execute. Keep slides ≤ 8 for carousels, ≤ 3 for stories.
  `.trim();

  const prompt = `
Post goal: ${input.post.goal}
Hook: ${input.post.hook}
Brand: ${input.brand.name} — ${input.brand.essence}
${input.product ? `Product: ${input.product.name} (${input.product.category}) — image: ${input.product.imageUrl ?? "n/a"}` : ""}
  `.trim();

  return aiStructured(VisualBriefSchema, { system, prompt, temperature: 0.6 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SCHEDULER (side-effecting)
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduledPost = {
  id: string;
  merchantId?: string;
  post: PlannedPost;
  copies: Partial<Record<Platform, Copy>>;
  visualBrief?: VisualBrief;
  status: "scheduled" | "publishing" | "published" | "failed";
  publishedAt?: string;
  error?: string;
};

export interface SocialStore {
  upsertPost(p: ScheduledPost): Promise<void>;
  listDue(beforeISO: string): Promise<ScheduledPost[]>;
  markPublished(id: string, when: string, remoteIds?: Record<string, string>): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export async function scheduler(opts: {
  store: SocialStore;
  connectors?: PlatformConnector[];
  connectorsForMerchant?: (merchantId: string) => PlatformConnector[] | Promise<PlatformConnector[]>;
  now?: Date;
}) {
  const nowISO = (opts.now ?? new Date()).toISOString();
  const due = await opts.store.listDue(nowISO);
  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const sp of due) {
    try {
      const connectors =
        sp.merchantId && opts.connectorsForMerchant
          ? await opts.connectorsForMerchant(sp.merchantId)
          : (opts.connectors ?? []);

      const remoteIds: Record<string, string> = {};
      for (const platform of sp.post.platforms) {
        const conn = connectors.find((c) => c.platform === platform);
        const copy = sp.copies[platform];
        if (!conn || !copy) continue;
        const { remoteId } = await conn.publish({ copy, visualBrief: sp.visualBrief });
        remoteIds[platform] = remoteId;
      }
      await opts.store.markPublished(sp.id, new Date().toISOString(), remoteIds);
      results.push({ id: sp.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await opts.store.markFailed(sp.id, msg);
      results.push({ id: sp.id, ok: false, error: msg });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ENGAGER
// ─────────────────────────────────────────────────────────────────────────────

export async function engager(input: {
  brand: BrandVoice;
  platform: Platform;
  context: { kind: "dm" | "comment" | "mention"; from: string; text: string; productMentioned?: Product };
}): Promise<ReplyDecision> {
  const system = `
You are the engagement agent for arabclue. You read an incoming message on ${input.platform} and decide:
1. reply (with text) — when a clean, brand-consistent reply will serve the customer
2. react — for simple positive engagement (likes, emoji)
3. escalate — when the message is a complaint, refund request, legal threat, or anything sensitive
4. ignore — for spam, trolls, or off-topic

Default: reply concisely in the brand's dialect, never make pricing commitments, never quote delivery times
unless explicitly given them.

ESCALATE triggers (always):
- Refund / return requests
- Allegations of harm, side effects, or product defect
- Mentions of regulators (Maroof, CCHI, ZATCA, etc.)
- Any "I will sue / report you" language
- Anything in a language other than Arabic / English you cannot confidently answer

VOICE:
- Brand: ${input.brand.name}
- Dialect: ${input.brand.dialect}
- Attributes: ${input.brand.attributes.join(", ")}
  `.trim();

  const prompt = `
Incoming on ${input.platform}, kind=${input.context.kind}, from=${input.context.from}:

"${input.context.text}"

${input.context.productMentioned ? `Product mentioned: ${input.context.productMentioned.name} (${input.context.productMentioned.id})` : ""}
  `.trim();

  return aiStructured(ReplyDecisionSchema, { system, prompt, temperature: 0.4 });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION — full pipeline
// ─────────────────────────────────────────────────────────────────────────────

export async function runSocialPipeline(input: {
  brand: BrandVoice;
  products: Product[];
  platforms: Platform[];
  horizonDays: number;
}) {
  const horizon = { startISO: new Date().toISOString(), days: input.horizonDays };
  const plan = await planner({ brand: input.brand, products: input.products, horizon, platforms: input.platforms });

  const fleshed = await Promise.all(
    plan.map(async (post) => {
      const product = post.productIds[0]
        ? input.products.find((p) => p.id === post.productIds[0])
        : undefined;

      const copies: Partial<Record<Platform, Copy>> = {};
      for (const platform of post.platforms) {
        copies[platform] = await copywriter({ post, brand: input.brand, product, platform });
      }
      const visualBrief = await visualist({ post, brand: input.brand, product, platform: post.platforms[0] });
      return { post, copies, visualBrief };
    })
  );

  return fleshed;
}
