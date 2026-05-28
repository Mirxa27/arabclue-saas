import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySallaWebhook } from "@/lib/salla/oauth";

describe("verifySallaWebhook", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ event: "order.created", merchant: 123, data: {} });
  const validSignature = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifySallaWebhook(body, validSignature, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySallaWebhook(body + "x", validSignature, secret)).toBe(false);
  });

  it("rejects a forged signature", () => {
    const forged = createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(verifySallaWebhook(body, forged, secret)).toBe(false);
  });
});
