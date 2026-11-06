import { NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { reportError } from "@/lib/observability/error-reporter";
import { HttpError } from "@/lib/api/errors";
import { unlinkSallaStore } from "@/lib/salla/connect";

const ROUTE = "POST /api/merchant/disconnect-salla";

/**
 * Disconnect Salla: drops the encrypted tokens and the store link (so the store's webhooks stop
 * reaching this merchant). Salla tokens and the store link are not writable through the Data API;
 * the session check scopes this service-role write to the caller's own merchant row.
 */
export async function POST() {
  try {
    const merchant = await requireMerchantApi();
    try {
      await unlinkSallaStore(getServiceSupabase(), merchant.id);
    } catch (err) {
      reportError(err, { route: ROUTE, merchantId: merchant.id });
      throw new HttpError(500, "Disconnect Salla failed", "db_write_failed");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
