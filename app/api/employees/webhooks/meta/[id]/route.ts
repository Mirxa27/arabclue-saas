/**
 * Messenger + Instagram Direct webhook per employee (the merchant's own Meta app).
 * URL: /api/employees/webhooks/meta/[id] — set it, with the integration's verify
 * token, for both the Page and the Instagram objects in the App Dashboard.
 * Logic: lib/employees/inbound/meta.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { receiveMetaWebhook, verifyMetaWebhookSubscription } from "@/lib/employees/inbound/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await verifyMetaWebhookSubscription(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/webhooks/meta/:id" });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    return await receiveMetaWebhook(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/webhooks/meta/:id" });
  }
}
