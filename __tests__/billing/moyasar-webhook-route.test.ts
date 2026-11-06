/**
 * F07 + critic-5: Moyasar authenticates webhooks with the `secret_token` field of the body
 * (no signature header). The route caps the body, requires MOYASAR_WEBHOOK_SECRET (503 when
 * unset), compares secret_token in constant time BEFORE the event schema runs, bounds
 * metadata, and processes each event id once.
 *
 * MOYASAR_SAMPLE is the `card_auth_authenticated` example from Moyasar's webhook reference,
 * verbatim: https://docs.moyasar.com/api/other/webhooks/webhook-reference ("Example:
 * card_auth_authenticated", read 2026-11-06). Its secret_token is the placeholder value
 * "your-webhook-secret".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoyasarPaymentSchema } from "@/lib/moyasar/types";
import { hasValidMoyasarSecretToken } from "@/lib/moyasar/webhook";
import { createClaimDb, rawPost, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({ db: null as unknown as ClaimDb }));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/billing/service", () => ({ handleMoyasarWebhookPayment: vi.fn(async () => ({ handled: true })) }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { POST } from "@/app/api/billing/webhook/route";
import { handleMoyasarWebhookPayment } from "@/lib/billing/service";

const MOYASAR_SAMPLE = `{
  "id": "8f2c1d4e-7a3b-4c9d-8e1f-2a3b4c5d6e7f",
  "type": "card_auth_authenticated",
  "created_at": "2026-05-20T10:00:00Z",
  "secret_token": "your-webhook-secret",
  "account_name": "My Store",
  "live": true,
  "data": {
    "id": "ca_2a1b...",
    "status": "authenticated",
    "amount": 10000,
    "currency": "SAR",
    "callback_url": "https://merchant.example/3ds/return",
    "transaction_url": null,
    "card": { "company": "visa", "last_digits": "1111" },
    "result": {
      "eci": "05",
      "authentication_value": "AAICCGhVkQAAACcQaCFSdYh0YUg=",
      "ds_transaction_id": "f8c3a0d2-7e76-4df1-8ba4-f457386d14bf",
      "version": "2.2.0",
      "transaction_status": "Y",
      "auth_scheme": "visa",
      "is_frictionless": false
    },
    "created_at": "2026-05-20T10:00:00Z"
  }
}`;

const SECRET = "your-webhook-secret";
const PAYMENT_ID = "6e1d2c3b-4a59-4687-9a0b-1c2d3e4f5a6b";

/** The documented envelope carrying a payment (payment_* events: "data … a payment"). */
function paymentPaid(over: Record<string, unknown> = {}, dataOver: Record<string, unknown> = {}) {
  const sample = JSON.parse(MOYASAR_SAMPLE) as Record<string, unknown>;
  return {
    ...sample,
    id: "1f0e2d3c-4b5a-4697-8e8f-7a6b5c4d3e2f",
    type: "payment_paid",
    data: {
      id: PAYMENT_ID,
      status: "paid",
      amount: 29900,
      currency: "SAR",
      description: "arabclue plus",
      callback_url: "https://arabclue.test/billing/complete",
      metadata: { merchant_id: "m1", plan: "plus", intent_id: "i1" },
      created_at: "2026-11-06T10:00:00Z",
      ...dataOver
    },
    ...over
  };
}

const post = (body: unknown) =>
  POST(rawPost("https://arabclue.test/api/billing/webhook", typeof body === "string" ? body : JSON.stringify(body), { "content-type": "application/json" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.db = createClaimDb();
  process.env.MOYASAR_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.MOYASAR_WEBHOOK_SECRET;
});

describe("POST /api/billing/webhook", () => {
  it("accepts Moyasar's documented sample (card_auth_authenticated): authenticated, acknowledged, nothing activated", async () => {
    const res = await post(MOYASAR_SAMPLE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "card_auth_authenticated" });
    expect(h.db.claimCalls()).toBe(0);
    expect(handleMoyasarWebhookPayment).not.toHaveBeenCalled();
  });

  it("processes payment_paid once and acknowledges the replay as a duplicate", async () => {
    const first = await post(paymentPaid());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(handleMoyasarWebhookPayment).toHaveBeenCalledWith(PAYMENT_ID);

    const replay = await post(paymentPaid());
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(handleMoyasarWebhookPayment).toHaveBeenCalledTimes(1);
    expect(h.db.claims.get("moyasar:1f0e2d3c-4b5a-4697-8e8f-7a6b5c4d3e2f")).toBe("done");
  });

  it.each([
    ["a wrong secret_token", paymentPaid({ secret_token: "guessed-secret" })],
    ["no secret_token", paymentPaid({ secret_token: undefined })],
    ["a non-string secret_token", paymentPaid({ secret_token: 12345 })]
  ])("401 for %s — before any schema parsing or DB access", async (_l, body) => {
    const res = await post(body);
    expect(res.status).toBe(401);
    expect(h.db.calls).toEqual([]);
    expect(h.db.claimCalls()).toBe(0);
    expect(handleMoyasarWebhookPayment).not.toHaveBeenCalled();
  });

  it("503 when MOYASAR_WEBHOOK_SECRET is unset — no unauthenticated mode", async () => {
    delete process.env.MOYASAR_WEBHOOK_SECRET;
    const res = await post(paymentPaid());
    expect(res.status).toBe(503);
    expect(handleMoyasarWebhookPayment).not.toHaveBeenCalled();
  });

  it("an unauthenticated body with a huge metadata record is refused before zod sees it", async () => {
    const metadata = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 1]));
    const res = await post(paymentPaid({ secret_token: "nope" }, { metadata }));
    expect(res.status).toBe(401);
  });

  it("an authenticated payment with more than 30 metadata keys is a 400 (Moyasar's own limit)", async () => {
    const metadata = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, "v"]));
    const res = await post(paymentPaid({}, { metadata }));
    expect(res.status).toBe(400);
    expect(handleMoyasarWebhookPayment).not.toHaveBeenCalled();
  });

  it("413 for an oversized body; 400 for invalid JSON", async () => {
    expect((await post(`{"pad":"${"x".repeat(300_000)}"}`)).status).toBe(413);
    expect((await post("{not json")).status).toBe(400);
  });

  it("a processing failure releases the claim so Moyasar's retry is processed", async () => {
    vi.mocked(handleMoyasarWebhookPayment).mockRejectedValueOnce(new Error("Moyasar API down"));
    expect((await post(paymentPaid())).status).toBe(500);
    expect((await post(paymentPaid())).status).toBe(200);
    expect(handleMoyasarWebhookPayment).toHaveBeenCalledTimes(2);
  });
});

describe("Moyasar helpers", () => {
  it("hasValidMoyasarSecretToken compares the body field in constant time", () => {
    expect(hasValidMoyasarSecretToken(JSON.parse(MOYASAR_SAMPLE), SECRET)).toBe(true);
    expect(hasValidMoyasarSecretToken({ secret_token: "your-webhook-secreT" }, SECRET)).toBe(false);
    expect(hasValidMoyasarSecretToken({ secret_token: "" }, SECRET)).toBe(false);
    expect(hasValidMoyasarSecretToken([SECRET], SECRET)).toBe(false);
    expect(hasValidMoyasarSecretToken({ secret_token: SECRET }, "")).toBe(false);
  });

  it("payment metadata is bounded by Moyasar's documented limits (30 keys, 40-char keys, 500-char values)", () => {
    const base = { id: PAYMENT_ID, status: "paid", amount: 100, currency: "SAR", created_at: "2026-11-06T00:00:00Z" };
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "v"]));
    expect(MoyasarPaymentSchema.safeParse({ ...base, metadata: keys(30) }).success).toBe(true);
    expect(MoyasarPaymentSchema.safeParse({ ...base, metadata: keys(31) }).success).toBe(false);
    expect(MoyasarPaymentSchema.safeParse({ ...base, metadata: { ["k".repeat(41)]: "v" } }).success).toBe(false);
    expect(MoyasarPaymentSchema.safeParse({ ...base, metadata: { k: "v".repeat(501) } }).success).toBe(false);
    expect(MoyasarPaymentSchema.safeParse({ ...base, metadata: null }).success).toBe(true);
    expect(MoyasarPaymentSchema.safeParse(base).success).toBe(true);
  });
});
