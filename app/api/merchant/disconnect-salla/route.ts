import { NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { assertNoDbError } from "@/lib/db/errors";

export async function POST() {
  try {
    const merchant = await requireMerchantApi();

    // Salla tokens/state are not writable through the Data API; the session check above
    // scopes this service-role write to the caller's own merchant row.
    const { error } = await getServiceSupabase()
      .from("merchants")
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        salla_state: null,
        uninstalled_at: new Date().toISOString()
      })
      .eq("id", merchant.id);

    assertNoDbError(error, "Disconnect Salla", { merchantId: merchant.id, route: "POST /api/merchant/disconnect-salla" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/merchant/disconnect-salla" });
  }
}
