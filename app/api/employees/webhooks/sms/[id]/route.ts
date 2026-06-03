/**
 * Twilio SMS webhook per employee.
 *
 * Twilio POSTs form-encoded params and signs each request with
 * `X-Twilio-Signature` (HMAC-SHA1 over the public URL + sorted params, keyed by
 * the Auth Token). We verify the signature before doing any work, hand the
 * message to the employee runtime (which replies via the outbound SMS adapter),
 * and return empty TwiML.
 *
 * URL: /api/employees/webhooks/sms/[id]
 */
import { NextResponse, type NextRequest } from "next/server";
import { loadEmployeeIntegration } from "@/lib/employees/integration-store";
import { parseTwilioSmsWebhook, verifyTwilioSignature } from "@/lib/employees/channels/sms";
import { handleInboundMessage } from "@/lib/employees/runtime";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptyTwiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" }
  });
}

/** Reconstruct the exact public URL Twilio signed (it must match what was registered). */
function publicUrl(req: NextRequest, pathname: string): string {
  const explicit = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const base =
    explicit ??
    (() => {
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
      return host ? `${proto}://${host}` : "";
    })();
  return `${base.replace(/\/$/, "")}${pathname}`;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;

    const limited = await enforceRateLimit(req, "employees:webhook:sms", 180, 60_000, id);
    if (limited instanceof NextResponse) return limited;

    const integration = await loadEmployeeIntegration(id, "twilio_sms");
    if (!integration) return NextResponse.json({ error: "no twilio_sms integration" }, { status: 404 });

    const authToken = integration.credentials.auth_token as string | undefined;
    if (!authToken) return NextResponse.json({ error: "twilio_sms not configured" }, { status: 400 });

    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

    const signature = req.headers.get("x-twilio-signature");
    const url = new URL(req.url);
    if (!verifyTwilioSignature(authToken, publicUrl(req, url.pathname), params, signature)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 403 });
    }

    const msg = parseTwilioSmsWebhook(params);
    if (msg && msg.text) {
      await handleInboundMessage({
        employeeId: id,
        channel: "twilio_sms",
        externalId: msg.from,
        text: msg.text
      });
    }
    return emptyTwiml();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }
}
