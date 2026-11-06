/**
 * GET/POST /api/employees/webhooks/meta/[id] — Messenger + Instagram DMs for one AI employee.
 *
 * The merchant's own Meta app points both its Page and Instagram webhook objects at
 * this URL. The employee id in the path is the routing key (tenant-bound lookup);
 * the body is trusted only after X-Hub-Signature-256 verifies over the exact raw
 * bytes with the integration's app secret.
 *
 * POST order (design: briefs/data/webhooks.md, "Meta inbound DM design"):
 *   rate limit → raw bytes (1 MB cap) → load meta+instagram rows → verify signature
 *   against each row's secret (none configured: 503; no match: 403) → JSON.parse
 *   (400) → object → kind (unknown / not connected: 200 ignored) → binding: the
 *   kind's own secret must be one that verified (403) → parse + filter → claim
 *   `${kind}:${mid}` per message → after(): AI reply per message, oldest first →
 *   200 { ok, accepted, duplicates, skipped }.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import {
  META_KINDS,
  META_WEBHOOK_PROVIDER,
  metaAccountIdFor,
  metaAppSecretFor,
  metaKindForObject,
  metaVerifyTokenFor,
  metaWebhookEventId,
  parseMetaMessagingWebhook,
  resolveMetaVerifyChallenge,
  verifyMetaSignature,
  type MetaInboundMessage
} from "@/lib/employees/channels/meta-inbound";
import { loadEmployeeIntegrations, touchIntegrationLastEvent } from "@/lib/employees/integration-store";
import { handleInboundMessage, logAction, type InboundStoreReason } from "@/lib/employees/runtime";
import type { IntegrationStatus } from "@/lib/employees/types";
import { readRawBody, WEBHOOK_MAX_BYTES } from "@/lib/http/raw-body";
import { enforceRateLimit, rateLimit } from "@/lib/security/rate-limit";
import { claimInboundEvents, errorText, inboundAck, processClaimedInbound } from "@/lib/webhooks/inbound-claims";
import { forbidden, invalidJson, isEmployeeId, logInboundRejected, notConfigured } from "./shared";

export const META_INBOUND_ROUTE = "POST /api/employees/webhooks/meta/:id";

/**
 * Rows in status 'error' (a send failed with a channel-level error) still receive:
 * Meta unsubscribes a callback that keeps failing, and the merchant should see the
 * customers' messages while fixing the connection. They get no AI reply.
 */
const RECEIVING_STATUSES: readonly IntegrationStatus[] = ["connected", "error"];

/** Per-sender AI reply budget (bounds LLM spend from one PSID / IGSID). */
const SENDER_REPLIES_PER_MINUTE = 20;

export async function verifyMetaWebhookSubscription(req: NextRequest, employeeId: string): Promise<Response> {
  const limited = await enforceRateLimit(req, "employees:webhook:meta:verify", 30, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;
  if (!isEmployeeId(employeeId)) return forbidden();

  // Stricter than the env-only fallback: the handshake needs a saved integration.
  const integrations = await loadEmployeeIntegrations(employeeId, META_KINDS, { statuses: RECEIVING_STATUSES });
  if (integrations.length === 0) return forbidden();

  const expected = integrations.map((i) => metaVerifyTokenFor(i.credentials));
  const challenge = resolveMetaVerifyChallenge(req.nextUrl.searchParams, expected);
  if (!challenge) return forbidden();
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function receiveMetaWebhook(req: NextRequest, employeeId: string): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "employees:webhook:meta", 180, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;

  // Hash the exact bytes: Meta signs the escaped-unicode JSON it sends, and
  // re-serialising (Arabic text in particular) would change them.
  const raw = await readRawBody(req, WEBHOOK_MAX_BYTES);

  const integrations = isEmployeeId(employeeId)
    ? await loadEmployeeIntegrations(employeeId, META_KINDS, { statuses: RECEIVING_STATUSES })
    : [];
  if (integrations.length === 0) return NextResponse.json({ error: "no meta integration" }, { status: 404 });

  const candidates = [...new Set(integrations.map((i) => metaAppSecretFor(i.credentials)).filter((s): s is string => !!s))];
  if (candidates.length === 0) {
    for (const i of integrations) await logInboundRejected(employeeId, i.kind, "no_app_secret");
    return notConfigured("meta app_secret not configured");
  }
  const header = req.headers.get("x-hub-signature-256");
  const verified = candidates.filter((secret) => verifyMetaSignature(raw, header, secret));
  if (verified.length === 0) return forbidden("invalid signature");

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return invalidJson();
  }

  const object = payload && typeof payload === "object" ? (payload as { object?: unknown }).object : undefined;
  const kind = metaKindForObject(object);
  if (!kind) return NextResponse.json({ ok: true, ignored: "object" });
  // Acknowledge objects we are not connected for, so Meta does not unsubscribe the app.
  const integration = integrations.find((i) => i.kind === kind);
  if (!integration) return NextResponse.json({ ok: true, ignored: "kind_not_connected" });

  // Binding: one app's signature must not authorise events for the other kind's row.
  const ownSecret = metaAppSecretFor(integration.credentials);
  if (!ownSecret || !verified.includes(ownSecret)) return forbidden("invalid signature");

  const accountId = metaAccountIdFor(kind, integration.credentials);
  if (!accountId) {
    await logInboundRejected(employeeId, kind, "account_not_configured");
    return NextResponse.json({ ok: true, ignored: "account_not_configured" });
  }

  const { accepted, skipped } = parseMetaMessagingWebhook(payload, { kind, accountId, nowMs: Date.now() });
  const summary = await claimInboundEvents(
    META_WEBHOOK_PROVIDER,
    accepted.map((m) => ({ eventId: metaWebhookEventId(kind, m.mid), item: m }))
  );

  const integrationBroken = integration.status === "error";
  const claimed = summary.claimed;
  after(async () => {
    await processClaimedInbound<MetaInboundMessage>({
      provider: META_WEBHOOK_PROVIDER,
      route: META_INBOUND_ROUTE,
      claimed,
      orderKey: (m) => m.senderId,
      handle: async (m) => {
        let storeOnly: Exclude<InboundStoreReason, "human_takeover"> | undefined = integrationBroken
          ? "integration_error"
          : undefined;
        if (!storeOnly) {
          const budget = await rateLimit(
            `employees:meta:sender:${employeeId}:${m.kind}:${m.senderId}`,
            SENDER_REPLIES_PER_MINUTE,
            60_000
          );
          if (!budget.success) storeOnly = "sender_rate_limited";
        }
        await handleInboundMessage({
          employeeId,
          channel: m.kind,
          externalId: m.senderId,
          text: m.text,
          ...(storeOnly ? { storeOnly } : {})
        });
      },
      onFailure: (m, err) =>
        logAction({
          employeeId,
          action: "inbound_message",
          channel: m.kind,
          target: m.senderId,
          status: "failure",
          result: { mid: m.mid, error: errorText(err) }
        })
    });
    await touchIntegrationLastEvent([integration.id]);
  });

  return inboundAck(summary, META_INBOUND_ROUTE, { skipped });
}
