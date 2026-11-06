import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { notFound } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  WATHQ_LOOKUPS_PER_MINUTE,
  assertWathqAvailable,
  lookupCrForMerchant,
  parseCrNumber
} from "@/lib/wathq/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "GET /api/wathq/[cr]";

/**
 * Commercial-registry summary for a CR number (Pro). 400 bad CR · 503 switched off by the
 * platform admin / not configured / Wathq unavailable · 402 plan · 429 per-merchant limits ·
 * 404 unknown CR (cached for 24 h) · 502 unexpected Wathq response.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ cr: string }> }) {
  try {
    const params = await props.params;
    const merchant = await requireMerchantApi();
    const cr = parseCrNumber(params.cr);
    const apiKey = await assertWathqAvailable(merchant);

    const limited = await enforceRateLimit(req, "wathq:lookup", WATHQ_LOOKUPS_PER_MINUTE, 60_000, { identity: merchant.id });
    if (limited instanceof NextResponse) return limited;

    const data = await lookupCrForMerchant({ merchantId: merchant.id, cr, apiKey, serviceClient: getServiceSupabase() });
    if (!data) throw notFound("CR");
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
