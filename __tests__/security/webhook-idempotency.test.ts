import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimWebhookEvent,
  hashWebhookPayload,
  sallaWebhookEventId
} from "@/lib/webhooks/idempotency";

/** Minimal fake: a unique index on (provider,event_id) raises 23505 on replay. */
function fakeSupabase(seen: Set<string>): SupabaseClient {
  return {
    from() {
      return {
        insert: async (row: { provider: string; event_id: string }) => {
          const key = `${row.provider}:${row.event_id}`;
          if (seen.has(key)) return { error: { code: "23505", message: "duplicate key value" } };
          seen.add(key);
          return { error: null };
        }
      };
    }
  } as unknown as SupabaseClient;
}

describe("claimWebhookEvent (replay protection)", () => {
  it("claims a new event, then reports the replay as duplicate", async () => {
    const sb = fakeSupabase(new Set());
    expect(await claimWebhookEvent(sb, "salla", "evt-1")).toBe("new");
    expect(await claimWebhookEvent(sb, "salla", "evt-1")).toBe("duplicate");
    // a different provider with the same id is independent
    expect(await claimWebhookEvent(sb, "moyasar", "evt-1")).toBe("new");
  });

  it("throws on a non-unique-violation database error", async () => {
    const sb = {
      from: () => ({ insert: async () => ({ error: { code: "08006", message: "connection failed" } }) })
    } as unknown as SupabaseClient;
    await expect(claimWebhookEvent(sb, "salla", "x")).rejects.toThrow(/idempotency insert failed: connection failed/);
  });
});

describe("webhook event id helpers", () => {
  it("hashWebhookPayload is deterministic sha256 hex", () => {
    expect(hashWebhookPayload("abc")).toBe(hashWebhookPayload("abc"));
    expect(hashWebhookPayload("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashWebhookPayload("abc")).not.toBe(hashWebhookPayload("abd"));
  });

  it("derives a stable Salla event id from event/merchant/created_at", () => {
    const raw = JSON.stringify({ event: "order.created", merchant: 9 });
    expect(sallaWebhookEventId(raw, { event: "order.created", merchant: 9, created_at: "2026-01-01T00:00:00Z" })).toBe(
      "order.created:9:2026-01-01T00:00:00Z"
    );
  });

  it("falls back to a payload hash when created_at is absent", () => {
    const raw = JSON.stringify({ event: "order.created", merchant: 9 });
    expect(sallaWebhookEventId(raw, { event: "order.created", merchant: 9 })).toMatch(/^sha256:[0-9a-f]{32}$/);
  });
});
