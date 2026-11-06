import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  hashWebhookPayload,
  releaseWebhookEvent,
  runWebhookOnce,
  sallaWebhookEventId
} from "@/lib/webhooks/idempotency";

type Row = { status: "processing" | "done" | "failed"; attempts: number; last_error: string | null };

/**
 * In-memory stand-in for public.claim_webhook_event + the webhook_events table.
 * Mirrors the SQL state machine that supabase/tests/10_webhook_claims.test.sql
 * proves against a real PostgreSQL.
 */
function fakeSupabase(rows = new Map<string, Row>()) {
  const key = (p: string, e: string) => `${p}:${e}`;
  const client = {
    rows,
    async rpc(fn: string, args: { p_provider: string; p_event_id: string }) {
      if (fn !== "claim_webhook_event") return { data: null, error: { code: "PGRST202", message: "unknown" } };
      const k = key(args.p_provider, args.p_event_id);
      const row = rows.get(k);
      if (!row) {
        rows.set(k, { status: "processing", attempts: 1, last_error: null });
        return { data: "new", error: null };
      }
      if (row.status === "failed") {
        row.status = "processing";
        row.attempts += 1;
        row.last_error = null;
        return { data: "retry", error: null };
      }
      return { data: row.status === "done" ? "duplicate" : "in_progress", error: null };
    },
    from() {
      const filters: Record<string, string> = {};
      let patch: Partial<Row> | null = null;
      const chain = {
        update(p: Partial<Row>) {
          patch = p;
          return chain;
        },
        eq(col: string, val: string) {
          filters[col] = val;
          if (filters.provider !== undefined && filters.event_id !== undefined) {
            const row = rows.get(key(filters.provider, filters.event_id));
            if (row && patch) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          }
          return chain;
        }
      };
      return chain;
    }
  };
  return client as unknown as SupabaseClient & { rows: Map<string, Row> };
}

describe("claimWebhookEvent (two-phase)", () => {
  it("claims a new event, reports a concurrent claim as in_progress, and a completed one as duplicate", async () => {
    const sb = fakeSupabase();
    expect(await claimWebhookEvent(sb, "salla", "evt-1")).toBe("new");
    expect(await claimWebhookEvent(sb, "salla", "evt-1")).toBe("in_progress");
    await completeWebhookEvent(sb, "salla", "evt-1");
    expect(await claimWebhookEvent(sb, "salla", "evt-1")).toBe("duplicate");
    // a different provider with the same id is independent
    expect(await claimWebhookEvent(sb, "moyasar", "evt-1")).toBe("new");
  });

  it("lets a provider retry re-claim an event whose handler failed", async () => {
    const sb = fakeSupabase();
    expect(await claimWebhookEvent(sb, "moyasar", "evt-2")).toBe("new");
    await releaseWebhookEvent(sb, "moyasar", "evt-2", new Error("db down token=abc123secret"));
    const row = sb.rows.get("moyasar:evt-2")!;
    expect(row.status).toBe("failed");
    expect(row.last_error).not.toContain("abc123secret"); // redacted before storage
    expect(await claimWebhookEvent(sb, "moyasar", "evt-2")).toBe("retry");
    expect(sb.rows.get("moyasar:evt-2")!.attempts).toBe(2);
  });

  it("falls back to insert-only claims when the RPC is not deployed yet", async () => {
    const seen = new Set<string>();
    const sb = {
      rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
      from: () => ({
        insert: async (row: { provider: string; event_id: string }) => {
          const k = `${row.provider}:${row.event_id}`;
          if (seen.has(k)) return { error: { code: "23505", message: "duplicate key value" } };
          seen.add(k);
          return { error: null };
        }
      })
    } as unknown as SupabaseClient;
    expect(await claimWebhookEvent(sb, "salla", "x")).toBe("new");
    expect(await claimWebhookEvent(sb, "salla", "x")).toBe("duplicate");
  });

  it("throws on other database errors and on unexpected RPC values", async () => {
    const down = { rpc: async () => ({ data: null, error: { code: "08006", message: "connection failed" } }) } as unknown as SupabaseClient;
    await expect(claimWebhookEvent(down, "salla", "x")).rejects.toThrow(/claim failed: connection failed/);
    const weird = { rpc: async () => ({ data: "maybe", error: null }) } as unknown as SupabaseClient;
    await expect(claimWebhookEvent(weird, "salla", "x")).rejects.toThrow(/unexpected value/);
  });
});

describe("runWebhookOnce", () => {
  it("processes once, then acknowledges redeliveries without running the handler", async () => {
    const sb = fakeSupabase();
    let runs = 0;
    const first = await runWebhookOnce(sb, "salla", "evt-3", async () => ++runs);
    expect(first).toEqual({ status: "processed", attempt: "new", result: 1 });
    expect(await runWebhookOnce(sb, "salla", "evt-3", async () => ++runs)).toEqual({ status: "duplicate" });
    expect(runs).toBe(1);
  });

  it("releases the claim and rethrows when the handler fails, so the retry is processed", async () => {
    const sb = fakeSupabase();
    await expect(
      runWebhookOnce(sb, "moyasar", "evt-4", async () => {
        throw new Error("transient");
      })
    ).rejects.toThrow("transient");
    const retry = await runWebhookOnce(sb, "moyasar", "evt-4", async () => "ok");
    expect(retry).toEqual({ status: "processed", attempt: "retry", result: "ok" });
  });

  it("does not run the handler while another worker holds the claim", async () => {
    const sb = fakeSupabase();
    await claimWebhookEvent(sb, "salla", "evt-5");
    let ran = false;
    expect(await runWebhookOnce(sb, "salla", "evt-5", async () => (ran = true))).toEqual({ status: "in_progress" });
    expect(ran).toBe(false);
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

  it("keeps two orders from the same store in the same second distinct", () => {
    const at = "Wed Jun 30 2021 12:16:25 GMT+0300";
    const a = sallaWebhookEventId("{}", { event: "order.created", merchant: 9, created_at: at, data: { id: 111 } });
    const b = sallaWebhookEventId("{}", { event: "order.created", merchant: 9, created_at: at, data: { id: 222 } });
    expect(a).toBe(`order.created:9:111:${at}`);
    expect(a).not.toBe(b);
  });

  it("falls back to a payload hash when created_at is absent", () => {
    const raw = JSON.stringify({ event: "order.created", merchant: 9 });
    expect(sallaWebhookEventId(raw, { event: "order.created", merchant: 9 })).toMatch(/^sha256:[0-9a-f]{32}$/);
  });
});
