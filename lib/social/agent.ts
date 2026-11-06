/**
 * arabclue social agent system.
 *
 * LLM agents:
 *   1. planner    — builds a content grid from catalog + calendar + brand voice
 *   2. copywriter — writes per-platform captions in Khaliji / MSA / English
 *   3. visualist  — produces a layout brief for carousels, stories, reels
 *   4. engager    — replies to incoming DMs / comments in dialect, escalates when needed
 *
 * Each agent is an async function from typed input to typed output. Plan generation (bounded
 * fan-out, validation, drafts) lives in ./plan.ts; publishing (claims, per-platform outcomes)
 * in ./scheduler.ts.
 */
import { aiStructured } from "@/lib/ai/providers";
import { getPersona } from "@/lib/agents/personas";
import { eventsBetween, nextSignificantEvents } from "./calendar";
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
  type Product,
  type ReplyDecision,
  type SaudiCalendarEvent,
  type VisualBrief
} from "./types";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 1. PLANNER
// ─────────────────────────────────────────────────────────────────────────────

export const PLANNER_MAX_POSTS = 40;

export const PlannerOutputSchema = z.object({
  posts: z.array(PlannedPostSchema).min(1).max(PLANNER_MAX_POSTS)
});

/** Output-token budget for `target` posts (~110–130 tokens per compact post + overhead). */
export function plannerMaxTokens(target: number): number {
  return Math.min(8000, 400 + 140 * Math.max(1, target));
}

const RIYADH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

/** "2026-11-06T15:00:00+03:00" for an instant (Asia/Riyadh has no DST). */
export function riyadhTimestamp(at: Date): string {
  const parts = Object.fromEntries(RIYADH_FORMAT.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:00+03:00`;
}

/** Calendar events the planner sees: the window (+1 week), or the next few when it is quiet. */
export function plannerEvents(start: Date, end: Date): SaudiCalendarEvent[] {
  const inWindow = eventsBetween(start, new Date(end.getTime() + 7 * 24 * 3600_000));
  const events = inWindow.length >= 3 ? inWindow : nextSignificantEvents(start, 6);
  return events.slice(0, 20);
}

export async function planner(input: {
  brand: BrandVoice;
  products: Product[];
  /** Posts must be scheduled inside [startISO, endISO]. */
  window: { startISO: string; endISO: string; days: number };
  platforms: Platform[];
  postsPerWeek: number;
  /** How many posts to produce: round(postsPerWeek × days / 7), at most PLANNER_MAX_POSTS. */
  target: number;
}): Promise<PlannedPost[]> {
  const start = new Date(input.window.startISO);
  const end = new Date(input.window.endISO);
  const events = plannerEvents(start, end);
  const target = Math.min(Math.max(1, input.target), PLANNER_MAX_POSTS);
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
- Use only these platforms: ${input.platforms.join(", ")}.
- An instagram post must reference at least one product marked [img] (Instagram posts need a catalog photo).
- Output exactly ${target} planned posts (${input.postsPerWeek} per week across the ${input.window.days}-day horizon).
- Every scheduledFor must be an ISO 8601 timestamp with the +03:00 offset (Asia/Riyadh),
  no earlier than ${riyadhTimestamp(start)} and no later than ${riyadhTimestamp(end)}.
  `.trim();

  const catalog = input.products
    .slice(0, 30)
    .map((p) => `- ${p.id} · ${p.name} · ${p.category} · ${p.price} ${p.currency}${p.imageUrl ? " [img]" : ""}`)
    .join("\n");
  const calendar = events.map((e) => `- ${e.date} · ${e.arabicName} (${e.name}) · importance=${e.importance}`).join("\n");

  const prompt = `
BRAND
- Name: ${input.brand.name}
- Essence: ${input.brand.essence}
- Attributes: ${input.brand.attributes.join(", ")}
- Default dialect: ${input.brand.dialect}

PLATFORMS ENABLED
${input.platforms.join(", ")}

PRODUCT CATALOG (sample of ${input.products.length}; [img] = has a photo)
${catalog || "(no products synced yet — plan brand and community posts)"}

UPCOMING SAUDI CALENDAR EVENTS (Asia/Riyadh dates; Hijri dates may move by a day after the moon sighting)
${calendar}

WINDOW: ${riyadhTimestamp(start)} → ${riyadhTimestamp(end)} (${input.window.days} days)
  `.trim();

  const result = await aiStructured(PlannerOutputSchema, {
    system,
    prompt,
    temperature: 0.5,
    maxTokens: plannerMaxTokens(target)
  });
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
  /** Why the previous attempt was rejected (e.g. over X's 280 weighted characters). */
  feedback?: string;
}): Promise<Copy> {
  const dialect = input.dialect ?? input.brand.dialect;
  const platformRules: Record<Platform, string> = {
    instagram: "Caption up to 220 words. Use 6-10 niche hashtags. No link in body — say 'link in bio'.",
    tiktok: "Hook in first 8 words. Vertical-video framing. 3-5 hashtags. Conversational.",
    x: "At most 240 characters in total — X counts every emoji as 2 and every link as 23, and 280 is the hard limit. One link allowed. 1-2 hashtags only.",
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

  const product = input.product
    ? `
PRODUCT
- Name: ${input.product.arabicName ?? input.product.name}
- Description: ${input.product.description}
- Price: ${input.product.price} ${input.product.currency}
- URL: ${input.product.url ?? "(use link in bio)"}
`
    : "(brand/community post — no specific product)";

  const prompt = `
POST INTENT
- Goal: ${input.post.goal}
- Hook line: ${input.post.hook}
- Rationale: ${input.post.rationale}
${product}
${input.feedback ? `REVISION NEEDED: ${input.feedback}` : ""}
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
Reference products by productId only; never invent image URLs.
  `.trim();

  const prompt = `
Post goal: ${input.post.goal}
Hook: ${input.post.hook}
Brand: ${input.brand.name} — ${input.brand.essence}
${input.product ? `Product: ${input.product.id} · ${input.product.name} (${input.product.category}) — catalog photo: ${input.product.imageUrl ? "yes" : "no"}` : ""}
  `.trim();

  return aiStructured(VisualBriefSchema, { system, prompt, temperature: 0.6 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ENGAGER
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
