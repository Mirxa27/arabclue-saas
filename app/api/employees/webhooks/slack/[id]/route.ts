/**
 * Slack Events API webhook per employee.
 * URL: /api/employees/webhooks/slack/[id]
 */
import { NextResponse, type NextRequest } from "next/server";
import { loadEmployeeIntegration } from "@/lib/employees/integration-store";
import { parseSlackEvent, verifySlackSignature } from "@/lib/employees/channels/slack";
import { handleInboundMessage } from "@/lib/employees/runtime";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "employees:webhook:slack", 180, 60_000, (await ctx.params).id);
    if (limited instanceof NextResponse) return limited;

    const raw = await req.text();
    const integration = await loadEmployeeIntegration((await ctx.params).id, "slack");
    if (!integration) return NextResponse.json({ error: "no slack integration" }, { status: 404 });

    const signingSecret =
      (integration.credentials.signing_secret as string | undefined) ??
      process.env.SLACK_SIGNING_SECRET;
    if (
      signingSecret &&
      !verifySlackSignature(
        signingSecret,
        req.headers.get("x-slack-signature"),
        req.headers.get("x-slack-request-timestamp"),
        raw
      )
    ) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const payload = JSON.parse(raw) as unknown;
    const incoming = parseSlackEvent(payload);
    if (!incoming) return NextResponse.json({ ok: true, skipped: true });

    if (incoming.channel === "__challenge__") {
      return NextResponse.json({ challenge: incoming.text });
    }

    const externalId = incoming.user ? `${incoming.channel}:${incoming.user}` : incoming.channel;
    await handleInboundMessage({
      employeeId: (await ctx.params).id,
      channel: "slack",
      externalId,
      text: incoming.text,
      contactName: incoming.user
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
