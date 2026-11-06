import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { sallaApiForMerchant, SallaConnectionError } from "@/lib/salla/tokens";
import { syncSallaProducts } from "@/lib/salla/products-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

const ROUTE = "POST /api/salla/products";

/**
 * Pull the merchant's Salla catalog into salla_products. 409 salla_not_connected /
 * salla_reconnect_required when there is no usable connection; 500 when a write fails.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();

    const limited = await enforceRateLimit(req, "salla:products-sync", 6, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const result = await syncSallaProducts({
      merchantId: merchant.id,
      // salla_products is merchant content: written through the merchant's RLS-scoped session
      db: await getServerSupabase(),
      fetchPage: (page, perPage) => sallaApiForMerchant<unknown>(merchant.id, `/products?per_page=${perPage}&page=${page}`),
      route: ROUTE
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SallaConnectionError) {
      // Stable code for the page (lib/salla/messages.ts); 5xx causes are reported by the token layer.
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return handleRouteError(err, { route: ROUTE });
  }
}
