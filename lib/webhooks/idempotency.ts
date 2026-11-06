import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSensitive, reportError } from "@/lib/observability/error-reporter";

/**
 * Two-phase webhook idempotency backed by public.claim_webhook_event
 * (supabase/migrations/20261106000100_webhook_claims.sql).
 *
 *   "new"         first delivery — process it
 *   "retry"       a previous attempt failed or went stale — process it again
 *   "duplicate"   already processed successfully — acknowledge, do nothing
 *   "in_progress" another worker holds a fresh claim — answer non-2xx so the
 *                 provider retries later (never 2xx: that worker may still fail)
 */
export type WebhookClaimResult = "new" | "retry" | "duplicate" | "in_progress";

export type WebhookClaimOptions = {
  payloadHash?: string;
  /** A 'processing' claim older than this is assumed crashed and may be re-claimed. */
  staleAfterSeconds?: number;
};

const CLAIM_RESULTS: ReadonlySet<string> = new Set(["new", "retry", "duplicate", "in_progress"]);
const DEFAULT_STALE_SECONDS = 300;

/** PostgREST "function not found" / Postgres "undefined function": migration not applied yet. */
function isMissingFunction(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** Postgres "undefined column": the two-phase columns are not there yet. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

async function legacyClaim(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  payloadHash?: string
): Promise<WebhookClaimResult> {
  const { error } = await supabase.from("webhook_events").insert({
    provider,
    event_id: eventId,
    payload_hash: payloadHash ?? null
  });
  if (error?.code === "23505") return "duplicate";
  if (error) throw new Error(`webhook idempotency insert failed: ${error.message}`);
  return "new";
}

/** Atomically claim (provider, eventId) for processing. */
export async function claimWebhookEvent(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  opts: WebhookClaimOptions = {}
): Promise<WebhookClaimResult> {
  const { data, error } = await supabase.rpc("claim_webhook_event", {
    p_provider: provider,
    p_event_id: eventId,
    p_payload_hash: opts.payloadHash ?? null,
    p_stale_seconds: opts.staleAfterSeconds ?? DEFAULT_STALE_SECONDS
  });
  if (error) {
    if (isMissingFunction(error)) return legacyClaim(supabase, provider, eventId, opts.payloadHash);
    throw new Error(`webhook idempotency claim failed: ${error.message}`);
  }
  if (typeof data !== "string" || !CLAIM_RESULTS.has(data)) {
    throw new Error(`webhook idempotency claim returned an unexpected value: ${JSON.stringify(data)}`);
  }
  return data as WebhookClaimResult;
}

/** Mark a claimed event as processed. Failures are reported, not thrown: the work already happened. */
export async function completeWebhookEvent(supabase: SupabaseClient, provider: string, eventId: string): Promise<void> {
  const { error } = await supabase
    .from("webhook_events")
    .update({ status: "done", last_error: null })
    .eq("provider", provider)
    .eq("event_id", eventId);
  if (error && !isMissingColumn(error)) {
    reportError(new Error(`webhook complete failed: ${error.message}`), { extra: { provider, eventId } });
  }
}

/**
 * Release a claim after a failed attempt so the provider's retry is processed
 * instead of being swallowed as a duplicate.
 */
export async function releaseWebhookEvent(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  cause: unknown
): Promise<void> {
  const message = redactSensitive(cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
  const { error } = await supabase
    .from("webhook_events")
    .update({ status: "failed", last_error: message })
    .eq("provider", provider)
    .eq("event_id", eventId);
  if (!error) return;
  if (isMissingColumn(error)) {
    // Legacy table (no status column): deleting the claim lets the retry re-claim it.
    const { error: delError } = await supabase.from("webhook_events").delete().eq("provider", provider).eq("event_id", eventId);
    if (!delError) return;
    reportError(new Error(`webhook release failed: ${delError.message}`), { extra: { provider, eventId } });
    return;
  }
  reportError(new Error(`webhook release failed: ${error.message}`), { extra: { provider, eventId } });
}

export type WebhookRunOutcome<T> =
  | { status: "processed"; attempt: "new" | "retry"; result: T }
  | { status: "duplicate" }
  | { status: "in_progress" };

/**
 * Claim → run → complete, or release on failure (and rethrow so the route
 * answers 5xx and the provider redelivers).
 */
export async function runWebhookOnce<T>(
  supabase: SupabaseClient,
  provider: string,
  eventId: string,
  handler: () => Promise<T>,
  opts: WebhookClaimOptions = {}
): Promise<WebhookRunOutcome<T>> {
  const claim = await claimWebhookEvent(supabase, provider, eventId, opts);
  if (claim === "duplicate") return { status: "duplicate" };
  if (claim === "in_progress") return { status: "in_progress" };
  try {
    const result = await handler();
    await completeWebhookEvent(supabase, provider, eventId);
    return { status: "processed", attempt: claim, result };
  } catch (err) {
    await releaseWebhookEvent(supabase, provider, eventId, err);
    throw err;
  }
}

/** Retention: drop finished claims older than `days` (never in-flight ones). */
export async function pruneWebhookEvents(supabase: SupabaseClient, days = 14): Promise<number> {
  const { data, error } = await supabase.rpc("prune_webhook_events", { p_older_than_days: days });
  if (error) {
    if (isMissingFunction(error)) return 0;
    throw new Error(`webhook prune failed: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

export function hashWebhookPayload(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Stable dedupe key for a Salla delivery. Includes the entity id (`data.id`,
 * e.g. the order id): event + merchant + second-resolution created_at alone
 * collides for two orders from the same store in the same second, and the
 * second order would be acknowledged as a duplicate and never invoiced.
 */
export function sallaWebhookEventId(
  raw: string,
  parsed: { event: string; merchant: string | number; created_at?: string; data?: unknown }
): string {
  const data = parsed.data;
  const entityId =
    data && typeof data === "object" && "id" in data && (typeof data.id === "string" || typeof data.id === "number")
      ? String(data.id)
      : null;
  if (parsed.created_at) {
    return entityId
      ? `${parsed.event}:${parsed.merchant}:${entityId}:${parsed.created_at}`
      : `${parsed.event}:${parsed.merchant}:${parsed.created_at}`;
  }
  return `sha256:${hashWebhookPayload(raw).slice(0, 32)}`;
}
