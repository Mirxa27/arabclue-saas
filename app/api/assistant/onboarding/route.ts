/**
 * arabclue — Onboarding Assistant API
 *
 * POST /api/assistant/onboarding
 *
 * Accepts the current wizard step, merchant context, and conversation history.
 * Returns an AI-generated response from Sara (سارة), the onboarding coordinator.
 *
 * Rate-limited to 20 requests per minute per user to prevent abuse.
 * Uses the global AI provider (GPT-4o-mini by default, or KSA-resident HUMAIN/ALLaM
 * when PDPL residency="ksa" is configured).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/route-handler";
import { aiText } from "@/lib/ai/providers";
import {
  buildOnboardingSystemPrompt,
  type OnboardingChatMessage,
  type OnboardingChatResponse,
} from "@/lib/agents/onboarding-prompts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// Request schema
// ─────────────────────────────────────────────────────────────────────────────

const OnboardingChatBody = z.object({
  /** Current wizard step (1-5) */
  step: z.number().int().min(1).max(5),
  /** Merchant context so far (businessName, plan, etc.) */
  context: z
    .object({
      businessName: z.string().optional(),
      vatNumber: z.string().optional(),
      essence: z.string().optional(),
      attributes: z.string().optional(),
      dialect: z.string().optional(),
      plan: z.string().optional(),
      dpaAccepted: z.boolean().optional(),
    })
    .optional()
    .default({}),
  /** Conversation history (oldest first) — max 10 messages */
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(20),
  /** PDPL residency hint */
  residency: z.enum(["global", "ksa", "eu"]).optional().default("global"),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Auth gate — must be logged in
    const user = await requireUser();

    // Parse and validate request body
    const body = OnboardingChatBody.parse(await req.json());

    // Build the system prompt scoped to the current step
    const system = buildOnboardingSystemPrompt(body.step as 1 | 2 | 3 | 4 | 5, body.context);

    // Build the conversation payload for the AI provider
    // Format: system prompt + history messages as user/assistant turns
    const conversationPrompt = buildConversationPrompt(body.messages);

    // Call the AI model
    const reply = await aiText({
      system,
      prompt: conversationPrompt,
      temperature: 0.7,
      maxTokens: 600,
      residency: body.residency,
    });

    // Extract an optional inline suggestion if the AI embedded one
    const { cleanReply, suggestion } = extractSuggestion(reply);

    const response: OnboardingChatResponse = {
      reply: cleanReply,
      ...(suggestion ? { suggestion } : {}),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
        "X-User-Id": user.id,
      },
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/assistant/onboarding" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert the history array into a natural-language conversation for the AI.
 * The system prompt already sets Sara's persona; we just need to render the
 * turns clearly so the model knows what was said.
 */
function buildConversationPrompt(messages: OnboardingChatMessage[]): string {
  if (messages.length === 0) {
    return "التاجر موجود في هذه الخطوة وينتظر مساعدتك. ابدأ بالترحيب والتوجيه المناسب لهذه المرحلة.";
  }

  const lines = messages.map((m) => {
    const speaker = m.role === "user" ? "التاجر" : "سارة";
    return `${speaker}: ${m.content}`;
  });

  return [
    "إليك سجل المحادثة السابق (من الأقدم للأحدث):",
    "",
    ...lines,
    "",
    "الآن، قم بالرد على آخر رسالة من التاجر بناءً على السياق أعلاه ودورك كمرشدة تهيئة.",
  ].join("\n");
}

/**
 * If the AI embedded a suggestion tag like [SUGGEST: label|labelAr],
 * extract it and return the clean reply + structured suggestion.
 */
function extractSuggestion(raw: string): {
  cleanReply: string;
  suggestion?: { label: string; labelAr: string };
} {
  const match = raw.match(/\[SUGGEST:\s*(.+?)\s*\|\s*(.+?)\s*\]/);
  if (!match) {
    return { cleanReply: raw.trim() };
  }

  const cleanReply = raw.replace(match[0], "").trim();
  return {
    cleanReply,
    suggestion: {
      label: match[1].trim(),
      labelAr: match[2].trim(),
    },
  };
}