/**
 * F05: /api/social/inbound — SOCIAL_INBOUND_SECRET || CRON_SECRET, constant time, fail closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawPost } from "../helpers/webhook-fakes";

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => ({}) }));
vi.mock("@/lib/social/handover", () => ({
  processSocialInbound: vi.fn(async () => ({ decision: { action: "escalate", reason: "refund" }, eventId: "e1" }))
}));

import { POST } from "@/app/api/social/inbound/route";
import { processSocialInbound } from "@/lib/social/handover";

const MERCHANT = "55555555-5555-4555-8555-555555555555";
const body = (over: Record<string, unknown> = {}) => ({ merchantId: MERCHANT, platform: "instagram", from: "@sara", text: "أبغى أرجع الطلب", ...over });
const call = (payload: unknown, auth?: string) =>
  POST(rawPost("https://arabclue.test/api/social/inbound", JSON.stringify(payload), { ...(auth ? { authorization: auth } : {}) }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env.SOCIAL_INBOUND_SECRET;
  delete process.env.CRON_SECRET;
});

describe("POST /api/social/inbound", () => {
  it("503 when neither secret is configured — 'Bearer undefined' does not pass", async () => {
    expect((await call(body(), "Bearer undefined")).status).toBe(503);
    expect(processSocialInbound).not.toHaveBeenCalled();
  });

  it("a blank SOCIAL_INBOUND_SECRET falls back to CRON_SECRET (|| not ??)", async () => {
    process.env.SOCIAL_INBOUND_SECRET = "";
    process.env.CRON_SECRET = "cron-secret-0123";
    expect((await call(body(), "Bearer cron-secret-0123")).status).toBe(200);
    expect((await call(body(), "Bearer ")).status).toBe(401);
  });

  it("SOCIAL_INBOUND_SECRET wins when set; anything else is 401", async () => {
    process.env.SOCIAL_INBOUND_SECRET = "social-secret-0123";
    process.env.CRON_SECRET = "cron-secret-0123";
    expect((await call(body(), "Bearer cron-secret-0123")).status).toBe(401);
    expect((await call(body())).status).toBe(401);
    const ok = await call(body(), "Bearer social-secret-0123");
    expect(ok.status).toBe(200);
    expect(vi.mocked(processSocialInbound).mock.calls[0][1]).toEqual({
      merchantId: MERCHANT,
      platform: "instagram",
      kind: "dm",
      from: "@sara",
      text: "أبغى أرجع الطلب"
    });
  });

  it("validates the body inside the handler: 400 for a bad merchant id or oversized text", async () => {
    process.env.SOCIAL_INBOUND_SECRET = "social-secret-0123";
    const auth = "Bearer social-secret-0123";
    expect((await call(body({ merchantId: "not-a-uuid" }), auth)).status).toBe(400);
    expect((await call(body({ text: "x".repeat(4001) }), auth)).status).toBe(400);
    expect((await POST(rawPost("https://arabclue.test/api/social/inbound", "{oops", { authorization: auth }))).status).toBe(400);
    expect(processSocialInbound).not.toHaveBeenCalled();
  });

  it("413 for an oversized body", async () => {
    process.env.SOCIAL_INBOUND_SECRET = "social-secret-0123";
    const res = await POST(
      rawPost("https://arabclue.test/api/social/inbound", `{"pad":"${"x".repeat(70_000)}"}`, { authorization: "Bearer social-secret-0123" })
    );
    expect(res.status).toBe(413);
    expect(processSocialInbound).not.toHaveBeenCalled();
  });
});
