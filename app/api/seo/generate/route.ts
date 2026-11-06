import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { generateSeoContent, SeoGenerateBodySchema } from "@/lib/seo/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ROUTE = "POST /api/seo/generate";

/**
 * Generate Arabic (or English) SEO copy for a synced product or a blog brief.
 * 401 signed out · 403 no merchant · 503 SEO switched off / provider not configurable ·
 * 402 plan · 400 body · 429 rate limit (per merchant) or monthly quota · 404 product ·
 * 502 the model failed (quota unit returned). See lib/seo/generate.ts for the response.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();

    const agents = await getAgentSettings();
    if (!agents.seo.enabled) {
      return NextResponse.json(
        { error: "وكيل السيو متوقف من إدارة المنصة · The SEO agent is disabled platform-wide" },
        { status: 503 }
      );
    }
    if (!merchantCanUseFeature(merchant, "seo")) {
      return NextResponse.json({ error: featureGateMessage("seo") }, { status: 402 });
    }

    const limited = await enforceRateLimit(req, "seo:generate", 10, 10 * 60_000, { identity: merchant.id });
    if (limited instanceof NextResponse) return limited;

    const parsed = SeoGenerateBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });

    const result = await generateSeoContent({
      merchant,
      body: parsed.data,
      settings: agents.seo,
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
