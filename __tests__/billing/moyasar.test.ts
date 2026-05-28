import { describe, expect, it } from "vitest";
import { BILLING_PLANS, formatHalalas, getPlan } from "@/lib/billing/plans";
import { verifyMoyasarWebhook } from "@/lib/moyasar/webhook";
import { createHmac } from "crypto";
import { verifyPaymentMatchesIntent } from "@/lib/moyasar/client";
import type { MoyasarPayment } from "@/lib/moyasar/types";

describe("billing plans", () => {
  it("defines SAR amounts in halalas above Moyasar minimum", () => {
    for (const plan of Object.values(BILLING_PLANS)) {
      expect(plan.amountHalalas).toBeGreaterThanOrEqual(100);
      expect(plan.currency).toBe("SAR");
    }
  });

  it("formats halalas as SAR", () => {
    expect(formatHalalas(9900)).toBe("99.00 SAR");
    expect(getPlan("plus").amountHalalas).toBe(29900);
  });
});

describe("moyasar webhook verification", () => {
  it("accepts valid HMAC signature", () => {
    const secret = "test_webhook_secret";
    const body = JSON.stringify({ type: "payment_paid", data: { id: "pay" } });
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyMoyasarWebhook(body, signature, secret)).toBe(true);
  });

  it("rejects tampered body", () => {
    const secret = "test_webhook_secret";
    const body = JSON.stringify({ type: "payment_paid" });
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyMoyasarWebhook(body + " ", signature, secret)).toBe(false);
  });
});

describe("verifyPaymentMatchesIntent", () => {
  it("throws when amount mismatches", () => {
    const payment: MoyasarPayment = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "paid",
      amount: 100,
      currency: "SAR",
      created_at: new Date().toISOString(),
      metadata: { merchant_id: "m1", plan: "lite", intent_id: "i1" }
    };

    expect(() =>
      verifyPaymentMatchesIntent({
        payment,
        expectedAmountHalalas: 9900,
        expectedCurrency: "SAR",
        expectedMetadata: { merchant_id: "m1", plan: "lite", intent_id: "i1" }
      })
    ).toThrow(/amount mismatch/i);
  });
});
