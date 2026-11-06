import { NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { loadSeoOverview } from "@/lib/seo/content";

export const dynamic = "force-dynamic";

/**
 * The SEO page's generator data: the merchant's generated content (newest 50), synced
 * products to generate for (100), this month's generation usage and the plan / platform
 * gates. 401 signed out · 403 without a merchant.
 */
export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    const agents = await getAgentSettings();
    const overview = await loadSeoOverview({
      merchant,
      agentEnabled: agents.seo.enabled,
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
    return NextResponse.json(overview, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/seo" });
  }
}
