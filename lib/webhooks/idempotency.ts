import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WebhookClaimResult = "new" | "duplicate";

/**
 * Atomically claim a webhook event. Returns "duplicate" if already processed.
 */
export async function claimWebhookEvent(
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

export function hashWebhookPayload(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function sallaWebhookEventId(raw: string, parsed: { event: string; merchant: string | number; created_at?: string }): string {
  if (parsed.created_at) {
    return `${parsed.event}:${parsed.merchant}:${parsed.created_at}`;
  }
  return `sha256:${hashWebhookPayload(raw).slice(0, 32)}`;
}
