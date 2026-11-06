/**
 * Claim-then-ack plumbing for webhooks whose real work is slow (an LLM turn):
 *
 *   1. after authenticating the exact request bytes, claim each provider message id
 *      synchronously (public.claim_webhook_event), so redeliveries and concurrent
 *      duplicates collapse on the unique index before anything runs;
 *   2. acknowledge fast (Meta wants a 200 within 5 s, Slack within 3 s);
 *   3. process the claimed items in next/server `after()` — complete each claim when
 *      processed, release it (status 'failed', reason kept) when not.
 *
 * Delivery is at most once per message id once acknowledged: a crash inside
 * `after()` leaves the claim 'processing' (visible in webhook_events) and the
 * provider does not redeliver an acknowledged event.
 */
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { redactSensitive, reportError } from "@/lib/observability/error-reporter";
import { claimWebhookEvent, completeWebhookEvent, releaseWebhookEvent } from "@/lib/webhooks/idempotency";

export type ClaimedInbound<T> = { eventId: string; item: T };

export type InboundClaimSummary<T> = {
  claimed: ClaimedInbound<T>[];
  duplicates: number;
  inProgress: number;
  /** Set when a claim threw (e.g. DB down): stop, process what was claimed, answer 5xx. */
  failure: unknown;
};

/**
 * Claim every candidate (deduplicated by event id, in order), a few at a time.
 * After a claim throws no new ones start; the summary carries the error.
 */
export async function claimInboundEvents<T>(
  provider: string,
  candidates: ReadonlyArray<ClaimedInbound<T>>,
  concurrency = 8
): Promise<InboundClaimSummary<T>> {
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.eventId)) return false;
    seen.add(c.eventId);
    return true;
  });
  const summary: InboundClaimSummary<T> = { claimed: [], duplicates: 0, inProgress: 0, failure: null };
  if (unique.length === 0) return summary;

  const sb = getServiceSupabase();
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((c) => claimWebhookEvent(sb, provider, c.eventId)));
    results.forEach((r, j) => {
      if (r.status === "rejected") {
        summary.failure ??= r.reason;
        return;
      }
      if (r.value === "new" || r.value === "retry") summary.claimed.push(batch[j]);
      else if (r.value === "duplicate") summary.duplicates += 1;
      else summary.inProgress += 1;
    });
    if (summary.failure) break;
  }
  return summary;
}

/**
 * Process claimed events — call from `after()`. Items sharing an order key (one
 * sender / chat) run strictly in order; different keys run up to `concurrency`
 * at a time. Each success completes its claim; each failure releases it, is
 * reported and handed to `onFailure`. Never throws.
 */
export async function processClaimedInbound<T>(opts: {
  provider: string;
  route: string;
  claimed: ReadonlyArray<ClaimedInbound<T>>;
  orderKey: (item: T) => string;
  handle: (item: T) => Promise<void>;
  onFailure?: (item: T, err: unknown) => Promise<void>;
  concurrency?: number;
}): Promise<void> {
  if (opts.claimed.length === 0) return;
  const sb = getServiceSupabase();

  const groups = new Map<string, ClaimedInbound<T>[]>();
  for (const c of opts.claimed) {
    const key = opts.orderKey(c.item);
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  const queue = [...groups.values()];

  const runGroup = async (group: ClaimedInbound<T>[]) => {
    for (const c of group) {
      try {
        await opts.handle(c.item);
        await completeWebhookEvent(sb, opts.provider, c.eventId);
      } catch (err) {
        await releaseWebhookEvent(sb, opts.provider, c.eventId, err).catch(() => undefined);
        reportError(err, { route: opts.route, extra: { provider: opts.provider, eventId: c.eventId } });
        if (opts.onFailure) await opts.onFailure(c.item, err).catch(() => undefined);
      }
    }
  };

  const workerCount = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (let group = queue.shift(); group; group = queue.shift()) await runGroup(group);
    })
  );
}

/** Short, secret-free error text for activity logs. */
export function errorText(err: unknown): string {
  return redactSensitive(err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * Status for a delivery once its claims are taken: 500 when a claim failed (the
 * provider redelivers; already-claimed ids dedupe), 409 when another worker holds
 * a claim (redeliver later — that worker may still fail), else 200.
 */
export function inboundAckStatus(summary: InboundClaimSummary<unknown>): 200 | 409 | 500 {
  if (summary.failure) return 500;
  if (summary.inProgress) return 409;
  return 200;
}

/** JSON acknowledgement with counts only — never message text (PDPL). */
export function inboundAck<T>(
  summary: InboundClaimSummary<T>,
  route: string,
  extra: Record<string, unknown> = {}
): NextResponse {
  const body = {
    accepted: summary.claimed.length,
    duplicates: summary.duplicates,
    ...(summary.inProgress ? { in_progress: summary.inProgress } : {}),
    ...extra
  };
  const status = inboundAckStatus(summary);
  if (status === 500) {
    reportError(summary.failure, { route, status: 500, extra: { step: "webhook_claim" } });
    return NextResponse.json({ ok: false, error: "temporarily unable to record the event", ...body }, { status });
  }
  if (status === 409) {
    return NextResponse.json({ ok: false, error: "event is being processed", ...body }, { status });
  }
  return NextResponse.json({ ok: true, ...body });
}
