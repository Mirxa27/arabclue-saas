/**
 * Twilio SMS webhook per employee.
 *
 * Twilio POSTs form-encoded params and signs each request with
 * `X-Twilio-Signature` (HMAC-SHA1 over the public URL + sorted params, keyed by
 * the Auth Token). The signature is verified before any work, the employee
 * replies via the outbound SMS adapter, and Twilio gets empty TwiML.
 *
 * URL: /api/employees/webhooks/sms/[id] — logic: lib/employees/inbound/sms.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { receiveTwilioSmsWebhook } from "@/lib/employees/inbound/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    return await receiveTwilioSmsWebhook(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/webhooks/sms/:id" });
  }
}
