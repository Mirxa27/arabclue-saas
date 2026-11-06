/**
 * POST /api/brand-kit/generate — AI brand-voice suggestion from the store name.
 *
 * Signed-in users only (onboarding calls it before the merchant row exists, so no
 * merchant is required). Rate-limited per user: each call is a paid LLM request.
 * Returns { kit: { essence, attributes, favor_words, avoid_words, dialect } }; nothing
 * is saved — the caller shows it for review. 503 when no AI provider is configured.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/session";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { BrandKitGenerateBodySchema, generateBrandKitSuggestion } from "@/lib/agents/brand-kit-generator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
    const limited = await enforceRateLimit(req, "brand-kit:generate", 5, 10 * 60_000, user.id);
    if (limited instanceof NextResponse) return limited;

    const parsed = BrandKitGenerateBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }

    const kit = await generateBrandKitSuggestion(parsed.data);
    return NextResponse.json({ kit });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/brand-kit/generate" });
  }
}
