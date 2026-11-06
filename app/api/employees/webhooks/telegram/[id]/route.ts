/**
 * Telegram webhook per employee.
 * URL: /api/employees/webhooks/telegram/[id] — logic: lib/employees/inbound/telegram.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { receiveTelegramWebhook } from "@/lib/employees/inbound/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    return await receiveTelegramWebhook(req, (await ctx.params).id);
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/webhooks/telegram/:id" });
  }
}
