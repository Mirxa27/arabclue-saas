/**
 * WhatsApp webhook per employee.
 *
 * Meta calls:
 *   • GET  with hub.* query params on first registration (verification).
 *   • POST with message payloads thereafter, signed with X-Hub-Signature-256.
 *
 * URL: /api/employees/webhooks/whatsapp/[id] — logic: lib/employees/inbound/whatsapp.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { receiveWhatsAppWebhook, verifyWhatsAppWebhookSubscription } from "@/lib/employees/inbound/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    return await verifyWhatsAppWebhookSubscription(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/webhooks/whatsapp/:id" });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    return await receiveWhatsAppWebhook(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/webhooks/whatsapp/:id" });
  }
}
