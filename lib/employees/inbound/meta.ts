/**
 * GET/POST /api/employees/webhooks/meta/[id] — Messenger + Instagram DMs for one AI employee.
 *
 * The merchant's own Meta app points both its Page and Instagram webhook objects at
 * this URL. The employee id in the path is the routing key (tenant-bound lookup);
 * the body is trusted only after X-Hub-Signature-256 verifies over the exact raw
 * bytes with the integration's app secret (META_APP_SECRET only for a row whose Page
 * token was proven at connect to belong to the platform app — RB-W1).
 *
 * Only rows set up for DMs take part (Page token + Page id + the kind's account id —
 * metaDmEndpoint); e.g. the Instagram row the employee OAuth flow writes for content
 * publishing is ignored (RB-W2).
 *
 * POST order (design: briefs/data/webhooks.md, "Meta inbound DM design"):
 *   rate limit → raw bytes (1 MB cap) → load the DM rows (none: 404) → verify the
 *   signature against each row's secret (none configured: 503; no match: 403, noted
 *   on the channel the body claims) → JSON.parse (400) → object → kind (unknown /
 *   no DM row: 200 ignored) → binding: the kind's own secret must be one that
 *   verified (none: 503, other: 403 — both noted) → parse + filter → claim
 *   `${kind}:${mid}` per message → after(): AI reply per message, oldest first →
 *   200 { ok, accepted, duplicates, skipped }.
 *
 * Refusals the merchant can fix are noted in the employee's activity
 * (action 'inbound_rejected', reasons no_app_secret / signature_mismatch; throttled).
 */
import { after, NextResponse, type NextRequest } from "next/server";
import {
  claimedMetaKind,
  isMetaSignatureHeader,
  META_KINDS,
  META_WEBHOOK_PROVIDER,
  metaAppSecretFor,
  metaDmEndpoint,
  metaKindForObject,
  metaVerifyTokenFor,
  metaWebhookEventId,
  parseMetaMessagingWebhook,
  resolveMetaVerifyChallenge,
  verifyMetaSignature,
  type MetaInboundMessage,
  type MetaKind
} from "@/lib/employees/channels/meta-inbound";
import { loadEmployeeIntegrations, touchIntegrationLastEvent, type DecryptedIntegration } from "@/lib/employees/integration-store";
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

/** A Messenger / Instagram row set up for DMs, with the key its deliveries are verified with. */
type MetaDmRow = {
  integration: DecryptedIntegration;
  kind: MetaKind;
  accountId: string;
  /** metaAppSecretFor: own app_secret, META_APP_SECRET for a platform row, else null. */
  secret: string | null;
};

/** The employee's Messenger / Instagram rows that can take DMs (RB-W2), loaded with the receiving statuses. */
async function loadMetaDmRows(employeeId: string): Promise<MetaDmRow[]> {
  if (!isEmployeeId(employeeId)) return [];
  const integrations = await loadEmployeeIntegrations(employeeId, META_KINDS, { statuses: RECEIVING_STATUSES });
  const rows: MetaDmRow[] = [];
  for (const integration of integrations) {
    const endpoint = metaDmEndpoint(integration);
    if (!endpoint) continue;
    rows.push({ integration, kind: endpoint.kind, accountId: endpoint.accountId, secret: metaAppSecretFor(integration) });
  }
  return rows;
}

/**
 * A delivery no saved secret verifies. Usually the merchant saved the wrong App
 * Secret — or none — for the channel Meta delivers for, and every customer DM on it is
 * being refused: note that on the channel (throttled) so the workspace shows why. The
 * body is NOT trusted: its `object` only picks the channel, and nothing is noted for a
 * request that does not even look like a signed Meta delivery for a connected channel.
 */
async function noteUnverifiedDelivery(employeeId: string, rows: MetaDmRow[], raw: Uint8Array, header: string | null) {
  if (!isMetaSignatureHeader(header)) return;
  const claimed = claimedMetaKind(raw);
  const row = claimed ? rows.find((r) => r.kind === claimed) : undefined;
  if (!row) return;
  await logInboundRejected(employeeId, row.kind, row.secret ? "signature_mismatch" : "no_app_secret");
}

export async function verifyMetaWebhookSubscription(req: NextRequest, employeeId: string): Promise<Response> {
  const limited = await enforceRateLimit(req, "employees:webhook:meta:verify", 30, 60_000, employeeId);
  if (limited instanceof NextResponse) return limited;
  if (!isEmployeeId(employeeId)) return forbidden();

  // Stricter than the env-only fallback: the handshake needs a saved DM integration.
  const rows = await loadMetaDmRows(employeeId);
  if (rows.length === 0) return forbidden();

  const expected = rows.map((r) => metaVerifyTokenFor(r.integration.credentials));
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

  const rows = await loadMetaDmRows(employeeId);
  if (rows.length === 0) return NextResponse.json({ error: "no meta integration" }, { status: 404 });

  const candidates = [...new Set(rows.map((r) => r.secret).filter((s): s is string => !!s))];
  if (candidates.length === 0) {
    for (const r of rows) await logInboundRejected(employeeId, r.kind, "no_app_secret");
    return notConfigured("meta app_secret not configured");
  }
  const header = req.headers.get("x-hub-signature-256");
  const verified = candidates.filter((secret) => verifyMetaSignature(raw, header, secret));
  if (verified.length === 0) {
    await noteUnverifiedDelivery(employeeId, rows, raw, header);
    return forbidden("invalid signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return invalidJson();
  }

  const object = payload && typeof payload === "object" ? (payload as { object?: unknown }).object : undefined;
  const kind = metaKindForObject(object);
  if (!kind) return NextResponse.json({ ok: true, ignored: "object" });
  // Authenticated, but this kind has no DM row (none, or only e.g. the OAuth publishing row):
  // acknowledge so Meta does not unsubscribe the Page / IG account.
  const dm = rows.find((r) => r.kind === kind);
  if (!dm) return NextResponse.json({ ok: true, ignored: "kind_not_connected" });

  // Binding: one app's signature must not authorise events for the other kind's row.
  if (!dm.secret) {
    await logInboundRejected(employeeId, kind, "no_app_secret");
    return notConfigured(`${kind} app_secret not configured`);
  }
  if (!verified.includes(dm.secret)) {
    await logInboundRejected(employeeId, kind, "signature_mismatch");
    return forbidden("invalid signature");
  }

  const { integration, accountId } = dm;
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
