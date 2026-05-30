import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/security/rate-limit";
import { hashWebhookPayload, sallaWebhookEventId } from "@/lib/webhooks/idempotency";

describe("rateLimit", () => {
  it("allows requests under the limit", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const first = await rateLimit(key, 3, 60_000);
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(2);
  });

  it("blocks when limit exceeded", async () => {
    const key = `test:block:${Date.now()}:${Math.random()}`;
    await rateLimit(key, 2, 60_000);
    await rateLimit(key, 2, 60_000);
    const third = await rateLimit(key, 2, 60_000);
    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });
});

describe("webhook idempotency helpers", () => {
  it("hashes payload deterministically", () => {
    const a = hashWebhookPayload('{"event":"order.created"}');
    const b = hashWebhookPayload('{"event":"order.created"}');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("builds stable salla event ids", () => {
    const id = sallaWebhookEventId('{"event":"order.created"}', {
      event: "order.created",
      merchant: 123,
      created_at: "2025-01-01T00:00:00Z"
    });
    expect(id).toBe("order.created:123:2025-01-01T00:00:00Z");
  });
});
