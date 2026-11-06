import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { loadSeoSiteState, runAndStoreSiteAudit } from "@/lib/seo/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The merchant's saved store URL and latest stored audit ({ store_url, audit | null }). */
export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    const state = await loadSeoSiteState(await getServerSupabase(), merchant);
    return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/seo/audit" });
  }
}

/**
 * Run a real audit of the merchant's store_url (+ up to 3 product pages on the same site).
 * 401 · 403 no merchant · 402 plan without SEO · 429 rate limit / daily cap ·
 * 409 store_url_required · 400 store URL not auditable. Returns { audit }.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    if (!merchantCanUseFeature(merchant, "seo")) {
      return NextResponse.json({ error: featureGateMessage("seo") }, { status: 402 });
    }
    const limited = await enforceRateLimit(req, "seo:audit", 5, 10 * 60_000, { identity: merchant.id });
    if (limited instanceof NextResponse) return limited;

    const audit = await runAndStoreSiteAudit({
      merchant,
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
    return NextResponse.json({ audit });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/seo/audit" });
  }
}
