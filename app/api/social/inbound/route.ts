import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { handleSocialInbound, SOCIAL_INBOUND_ROUTE } from "@/lib/social/inbound-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Normalized inbound social message → engager agent → optional human escalation event.
 * Auth: `Authorization: Bearer $SOCIAL_INBOUND_SECRET` (falls back to CRON_SECRET; 503 when neither is set).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleSocialInbound(req);
  } catch (err) {
    return handleRouteError(err, { route: SOCIAL_INBOUND_ROUTE });
  }
}
