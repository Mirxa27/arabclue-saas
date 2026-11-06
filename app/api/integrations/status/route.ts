import { NextResponse } from "next/server";
import { AuthError, getSessionContext } from "@/lib/auth/session";
import { HttpError } from "@/lib/api/errors";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { getIntegrationStatus } from "@/lib/integrations/status";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/integrations/status";

/**
 * Connection state for the integrations page: Salla (connected / reconnect needed / claimable App
 * Store install / where "Connect Salla" goes), social channels, which OAuth providers the platform
 * has credentials for, and the admin's social switch. 401 signed out, 403 without a merchant.
 */
export async function GET() {
  try {
    const { user, merchant } = await getSessionContext();
    if (!user) throw new AuthError();
    if (!merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");

    const status = await getIntegrationStatus({
      merchant,
      user,
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
