/**
 * POST /api/employees/webhooks/slack/[id] — Slack Events API for one AI employee.
 *
 * F04: the request must carry a valid X-Slack-Signature for the integration's
 * signing secret (else env SLACK_SIGNING_SECRET, the platform app's secret for
 * OAuth-connected installs). No secret: 503; bad or stale signature: 403. Slack
 * retries anything not acknowledged within 3 s, so the event is claimed by its
 * event_id, acknowledged at once, and answered in after(); retries of a processed
 * event are acknowledged as duplicates.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { parseSlackEvent, verifySlackSignature, type SlackInboundMessage } from "@/lib/employees/channels/slack";
import { loadEmployeeIntegration, touchIntegrationLastEvent } from "@/lib/employees/integration-store";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";
import { readTextBody, WEBHOOK_MAX_BYTES } from "@/lib/http/raw-body";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { hashWebhookPayload } from "@/lib/webhooks/idempotency";
import { claimInboundEvents, errorText, inboundAck, processClaimedInbound } from "@/lib/webhooks/inbound-claims";
import {
  capInboundText,
  forbidden,
  invalidJson,
  isEmployeeId,
  logInboundRejected,
  nonEmptyString,
  notConfigured
} from "./shared";

export const SLACK_INBOUND_ROUTE = "POST /api/employees/webhooks/slack/:id";
export const SLACK_WEBHOOK_PROVIDER = "slack";

/** Slack's event_id ("globally unique across all workspaces"), else a hash of the body. */
export function slackEventId(payload: unknown, raw: string): string {
  const id = payload && typeof payload === "object" ? (payload as { event_id?: unknown }).event_id : undefined;
  return typeof id === "string" && id ? id : `sha256:${hashWebhookPayload(raw).slice(0, 32)}`;
}

export async function receiveSlackWebhook(req: NextRequest, employeeId: string): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "employees:webhook:slack", 180, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;

  const raw = await readTextBody(req, WEBHOOK_MAX_BYTES);
  const integration = isEmployeeId(employeeId) ? await loadEmployeeIntegration(employeeId, "slack") : null;
  if (!integration) return NextResponse.json({ error: "no slack integration" }, { status: 404 });

  const signingSecret =
    nonEmptyString(integration.credentials.signing_secret) ?? nonEmptyString(process.env.SLACK_SIGNING_SECRET);
  if (!signingSecret) {
    await logInboundRejected(employeeId, "slack", "no_signing_secret");
    return notConfigured("slack signing secret not configured");
  }
  const valid = verifySlackSignature(
    signingSecret,
    req.headers.get("x-slack-signature"),
    req.headers.get("x-slack-request-timestamp"),
    raw
  );
  if (!valid) return forbidden("invalid signature");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return invalidJson();
  }

  const incoming = parseSlackEvent(payload);
  if (incoming?.channel === "__challenge__") {
    // Events API URL verification handshake (signed, like every other request).
    return NextResponse.json({ challenge: incoming.text });
  }
  if (!incoming) return NextResponse.json({ ok: true, skipped: true });

  const message: SlackInboundMessage = { ...incoming, text: capInboundText(incoming.text) };
  const summary = await claimInboundEvents(SLACK_WEBHOOK_PROVIDER, [{ eventId: slackEventId(payload, raw), item: message }]);

  const claimed = summary.claimed;
  after(async () => {
    await processClaimedInbound<SlackInboundMessage>({
      provider: SLACK_WEBHOOK_PROVIDER,
      route: SLACK_INBOUND_ROUTE,
      claimed,
      orderKey: (m) => m.channel,
      handle: async (m) => {
        // The conversation is the Slack channel / DM: that is also where the reply is posted
        // (chat.postMessage needs a channel id — "C…:U…" is not one).
        await handleInboundMessage({
          employeeId,
          channel: "slack",
          externalId: m.channel,
          text: m.text,
          contactName: m.user
        });
      },
      onFailure: (m, err) =>
        logAction({
          employeeId,
          action: "inbound_message",
          channel: "slack",
          target: m.channel,
          status: "failure",
          result: { error: errorText(err) }
        })
    });
    if (claimed.length > 0) await touchIntegrationLastEvent([integration.id]);
  });

  return inboundAck(summary, SLACK_INBOUND_ROUTE);
}
