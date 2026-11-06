import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { assertCronAuthorized } from "@/lib/security/cron";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { probeSocialCron } from "@/lib/social/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "GET /api/cron/social-scheduler/probe";

/**
 * Side-effect-free check for the admin connection test (SW-14): same cron auth as the
 * scheduler, a read-only database query, no claims, no publishing. A separate path on purpose:
 * on a deployment that predates it, the admin test gets a 404 instead of running the publisher.
 */
export async function GET(req: NextRequest) {
  try {
    const denied = assertCronAuthorized(req);
    if (denied) return denied;
    const agents = await getAgentSettings();
    const probe = await probeSocialCron(agents.social.enabled);
    return NextResponse.json(probe, { status: probe.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
