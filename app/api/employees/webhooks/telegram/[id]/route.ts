/**
 * Telegram webhook per employee.
 * URL: /api/employees/webhooks/telegram/[id]
 */
import { NextResponse, type NextRequest } from "next/server";
import { loadEmployeeIntegration } from "@/lib/employees/integration-store";
import { parseTelegramUpdate } from "@/lib/employees/channels/telegram";
import { handleInboundMessage } from "@/lib/employees/runtime";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "employees:webhook:telegram", 180, 60_000, (await ctx.params).id);
    if (limited instanceof NextResponse) return limited;

    const integration = await loadEmployeeIntegration((await ctx.params).id, "telegram");
    if (!integration) return NextResponse.json({ error: "no telegram integration" }, { status: 404 });

    const expected = integration.credentials.webhook_secret as string | undefined;
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (expected && got !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const payload = await req.json();
    const incoming = parseTelegramUpdate(payload);
    if (!incoming || !incoming.text) return NextResponse.json({ ok: true, skipped: true });

    await handleInboundMessage({
      employeeId: (await ctx.params).id,
      channel: "telegram",
      externalId: String(incoming.chatId),
      text: incoming.text,
      contactName: incoming.fromName ?? incoming.from
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
