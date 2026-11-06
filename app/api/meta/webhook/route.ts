import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import {
  META_PLATFORM_ROUTE,
  receiveMetaPlatformWebhook,
  verifyMetaPlatformSubscription
} from "@/lib/meta/platform-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Platform Meta app webhook (Instagram comments/DMs, WhatsApp messages) for the
 * engager handover pipeline. Signed with META_APP_SECRET; logic: lib/meta/platform-webhook.ts.
 * AI-employee Messenger/Instagram DMs use /api/employees/webhooks/meta/[id] instead.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    return verifyMetaPlatformSubscription(req);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/meta/webhook" });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await receiveMetaPlatformWebhook(req);
  } catch (err) {
    return handleRouteError(err, { route: META_PLATFORM_ROUTE });
  }
}
