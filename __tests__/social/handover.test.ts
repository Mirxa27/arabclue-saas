import { describe, expect, it, vi, beforeEach } from "vitest";
import { verifyMetaWebhook } from "@/lib/meta/oauth";

describe("meta webhook verify", () => {
  beforeEach(() => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-me";
  });

  it("returns challenge when token matches", () => {
    expect(verifyMetaWebhook("subscribe", "verify-me", "12345")).toBe("12345");
  });

  it("returns null on mismatch", () => {
    expect(verifyMetaWebhook("subscribe", "wrong", "12345")).toBeNull();
  });
});

describe("processSocialInbound", () => {
  it("escalates to social.escalation event", async () => {
    vi.mock("@/lib/social/agent", () => ({
      engager: vi.fn().mockResolvedValue({
        action: "escalate",
        reason: "Refund request",
        reply: undefined
      })
    }));

    const { processSocialInbound } = await import("@/lib/social/handover");

    const inserts: unknown[] = [];
    const supabase = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === "brand_kits"
                  ? { data: { brand_name: "Test", essence: "x", attributes: [], dialect: "khaliji" } }
                  : table === "voice_configs"
                    ? { data: { escalation_phone: "+966500000000" } }
                    : { data: null }
            })
          }),
          insert: (row: unknown) => {
            inserts.push({ table, row });
            return {
              select: () => ({
                single: async () => ({ data: { id: "evt-1" } })
              })
            };
          }
        };
      }
    };

    const result = await processSocialInbound(supabase as never, {
      merchantId: "550e8400-e29b-41d4-a716-446655440000",
      platform: "instagram",
      kind: "comment",
      from: "@user",
      text: "I want a refund"
    });

    expect(result.decision.action).toBe("escalate");
    expect(inserts.some((i) => (i as { table: string }).table === "events")).toBe(true);
  });
});
