import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { assertCronAuthorized } from "@/lib/security/cron";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { runSocialPublishing } from "@/lib/social/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE = "GET /api/cron/social-scheduler";

/**
 * Publishes due, approved posts — each claimed by exactly one run (lib/social/scheduler.ts), so
 * duplicate cron deliveries or overlapping runs never post twice. Health checks use
 * /api/cron/social-scheduler/probe, which publishes nothing.
 */
export async function GET(req: NextRequest) {
  try {
    const denied = assertCronAuthorized(req);
    if (denied) return denied;

    const agents = await getAgentSettings();
    if (!agents.social.enabled) {
      return NextResponse.json({ ran: 0, skipped: "social agent disabled platform-wide" });
    }

    const summary = await runSocialPublishing({ maxPostsPerRun: agents.social.maxPostsPerRun });
    return NextResponse.json({ ran: summary.claimed, ...summary });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
