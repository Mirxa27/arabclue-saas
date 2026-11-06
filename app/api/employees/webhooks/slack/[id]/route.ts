/**
 * Slack Events API webhook per employee.
 * URL: /api/employees/webhooks/slack/[id] — logic: lib/employees/inbound/slack.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { receiveSlackWebhook } from "@/lib/employees/inbound/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    return await receiveSlackWebhook(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/webhooks/slack/:id" });
  }
}
