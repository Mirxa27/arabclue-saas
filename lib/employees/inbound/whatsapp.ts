/**
 * GET/POST /api/employees/webhooks/whatsapp/[id] — WhatsApp Cloud API webhook for one AI employee.
 *
 * F03: Meta signs every notification with X-Hub-Signature-256 = HMAC-SHA256 of the
 * raw body keyed with the app secret. The key is the integration's own `app_secret`
 * (the merchant's Meta app); only an OAuth-connected integration (the platform's
 * app, config.connected_via = 'oauth') may fall back to META_APP_SECRET. No secret:
 * 503. Bad signature: 403. Each WhatsApp message id is claimed once; the AI turn
 * runs in after().
 */
import { after, NextResponse, type NextRequest } from "next/server";
import { resolveMetaVerifyChallenge, verifyMetaSignature } from "@/lib/employees/channels/meta-inbound";
import { parseWhatsAppWebhook, type WhatsAppIncoming } from "@/lib/employees/channels/whatsapp";
import { loadEmployeeIntegration, touchIntegrationLastEvent, type DecryptedIntegration } from "@/lib/employees/integration-store";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";
import { readRawBody, WEBHOOK_MAX_BYTES } from "@/lib/http/raw-body";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { claimInboundEvents, errorText, inboundAck, processClaimedInbound } from "@/lib/webhooks/inbound-claims";
import {
  capInboundText,
  forbidden,
  INBOUND_MAX_AGE_MS,
  invalidJson,
  isEmployeeId,
  logInboundRejected,
  nonEmptyString,
  notConfigured
} from "./shared";

export const WHATSAPP_INBOUND_ROUTE = "POST /api/employees/webhooks/whatsapp/:id";
/** webhook_events.provider; the event id is the WhatsApp message id (wamid…). */
export const WHATSAPP_WEBHOOK_PROVIDER = "whatsapp";

/** The HMAC key for this integration's deliveries, or null when none is configured. */
export function whatsappAppSecretFor(integration: Pick<DecryptedIntegration, "credentials" | "config">): string | null {
  const own = nonEmptyString(integration.credentials?.app_secret);
  if (own) return own;
  if (integration.config?.connected_via === "oauth") return nonEmptyString(process.env.META_APP_SECRET);
  return null;
}

export type WhatsAppSkipReason = "foreign_number" | "non_text" | "stale";

/** Text messages for this integration's number that are still answerable, oldest first. */
export function selectWhatsAppMessages(
  messages: WhatsAppIncoming[],
  phoneNumberId: string | null,
  nowMs: number
): { accepted: WhatsAppIncoming[]; skipped: Partial<Record<WhatsAppSkipReason, number>> } {
  const skipped: Partial<Record<WhatsAppSkipReason, number>> = {};
  const skip = (r: WhatsAppSkipReason) => (skipped[r] = (skipped[r] ?? 0) + 1);
  const accepted: WhatsAppIncoming[] = [];
  for (const m of messages) {
    // One Meta app can route several numbers to this callback; answer only ours.
    if (phoneNumberId && m.phoneNumberId && m.phoneNumberId !== phoneNumberId) {
      skip("foreign_number");
      continue;
    }
    const text = m.text ? capInboundText(m.text) : "";
    if (!text) {
      skip("non_text");
      continue;
    }
    if (Number.isFinite(m.timestamp) && nowMs - m.timestamp * 1000 > INBOUND_MAX_AGE_MS) {
      skip("stale"); // outside the 24 h customer-service window: a free-form reply would be rejected
      continue;
    }
    accepted.push({ ...m, text });
  }
  accepted.sort((a, b) => a.timestamp - b.timestamp);
  return { accepted, skipped };
}

export async function verifyWhatsAppWebhookSubscription(req: NextRequest, employeeId: string): Promise<Response> {
  const limited = await enforceRateLimit(req, "employees:webhook:whatsapp:verify", 30, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;
  if (!isEmployeeId(employeeId)) return forbidden();

  const integration = await loadEmployeeIntegration(employeeId, "whatsapp");
  if (!integration) return forbidden();
  const expected =
    nonEmptyString(integration.credentials.verify_token) ?? nonEmptyString(process.env.WHATSAPP_VERIFY_TOKEN);
  const challenge = resolveMetaVerifyChallenge(req.nextUrl.searchParams, [expected]);
  if (!challenge) return forbidden();
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function receiveWhatsAppWebhook(req: NextRequest, employeeId: string): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "employees:webhook:whatsapp", 180, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;

  const raw = await readRawBody(req, WEBHOOK_MAX_BYTES);
  const integration = isEmployeeId(employeeId) ? await loadEmployeeIntegration(employeeId, "whatsapp") : null;
  if (!integration) return NextResponse.json({ error: "no whatsapp integration" }, { status: 404 });

  const secret = whatsappAppSecretFor(integration);
  if (!secret) {
    await logInboundRejected(employeeId, "whatsapp", "no_app_secret");
    return notConfigured("whatsapp app_secret not configured");
  }
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return forbidden("invalid signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return invalidJson();
  }
  const object = payload && typeof payload === "object" ? (payload as { object?: unknown }).object : undefined;
  if (object !== undefined && object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: "object" });
  }

  const { accepted, skipped } = selectWhatsAppMessages(
    parseWhatsAppWebhook(payload),
    nonEmptyString(integration.credentials.phone_number_id),
    Date.now()
  );
  const summary = await claimInboundEvents(
    WHATSAPP_WEBHOOK_PROVIDER,
    accepted.map((m) => ({ eventId: m.messageId, item: m }))
  );

  const claimed = summary.claimed;
  after(async () => {
    await processClaimedInbound<WhatsAppIncoming>({
      provider: WHATSAPP_WEBHOOK_PROVIDER,
      route: WHATSAPP_INBOUND_ROUTE,
      claimed,
      orderKey: (m) => m.from,
      handle: async (m) => {
        await handleInboundMessage({
          employeeId,
          channel: "whatsapp",
          externalId: m.from,
          text: m.text ?? "",
          contactName: m.contactName
        });
      },
      onFailure: (m, err) =>
        logAction({
          employeeId,
          action: "inbound_message",
          channel: "whatsapp",
          target: m.from,
          status: "failure",
          result: { messageId: m.messageId, error: errorText(err) }
        })
    });
    if (claimed.length > 0) await touchIntegrationLastEvent([integration.id]);
  });

  return inboundAck(summary, WHATSAPP_INBOUND_ROUTE, { skipped });
}
