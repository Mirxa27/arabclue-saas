/**
 * WhatsApp webhook per employee.
 *
 * Meta calls:
 *   • GET  with hub.* query params on first registration (verification).
 *   • POST with message payloads thereafter.
 *
 * URL: /api/employees/webhooks/whatsapp/[id]
 */
import { NextResponse, type NextRequest } from "next/server";
import { loadEmployeeIntegration } from "@/lib/employees/integration-store";
import { parseWhatsAppWebhook } from "@/lib/employees/channels/whatsapp";
import { handleInboundMessage } from "@/lib/employees/runtime";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse | Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");

  const integration = await loadEmployeeIntegration(ctx.params.id, "whatsapp");
  const expected =
    (integration?.credentials.verify_token as string | undefined) ?? process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge && token && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "employees:webhook:whatsapp", 180, 60_000, ctx.params.id);
    if (limited instanceof NextResponse) return limited;

    const integration = await loadEmployeeIntegration(ctx.params.id, "whatsapp");
    if (!integration) return NextResponse.json({ error: "no whatsapp integration" }, { status: 404 });

    const payload = await req.json();
    const messages = parseWhatsAppWebhook(payload);
    for (const m of messages) {
      if (!m.text) continue;
      await handleInboundMessage({
        employeeId: ctx.params.id,
        channel: "whatsapp",
        externalId: m.from,
        text: m.text,
        contactName: m.contactName
      });
    }
    return NextResponse.json({ ok: true, processed: messages.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
