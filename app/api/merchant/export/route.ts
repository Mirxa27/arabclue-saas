export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { buildMerchantExport } from "@/lib/merchant/pdpl";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** PDPL data portability: everything stored for the signed-in merchant (credentials excluded). */
export async function GET(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "merchant:export", 10, 60 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    // Service role after authentication: several tables are not readable by API roles.
    const exportPayload = await buildMerchantExport(getServiceSupabase(), merchant);

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="arabclue-export-${merchant.id.slice(0, 8)}.json"`,
        "cache-control": "no-store"
      }
    });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/merchant/export" });
  }
}
