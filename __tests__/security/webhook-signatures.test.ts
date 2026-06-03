import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySallaWebhook } from "@/lib/salla/oauth";
import { verifyMoyasarWebhook } from "@/lib/moyasar/webhook";

const sha256Hex = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

describe("verifySallaWebhook (HMAC-SHA256 hex, constant-time)", () => {
  const secret = "salla-webhook-secret";
  const body = JSON.stringify({ event: "order.created", merchant: 123, data: {} });

  it("accepts a correctly signed body", () => {
    expect(verifySallaWebhook(body, sha256Hex(secret, body), secret)).toBe(true);
  });
  it("rejects a signature made with the wrong secret", () => {
    expect(verifySallaWebhook(body, sha256Hex("wrong-secret", body), secret)).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(verifySallaWebhook(`${body} `, sha256Hex(secret, body), secret)).toBe(false);
  });
  it("rejects empty or non-hex signatures", () => {
    expect(verifySallaWebhook(body, "", secret)).toBe(false);
    expect(verifySallaWebhook(body, "not-hex", secret)).toBe(false);
  });
});

describe("verifyMoyasarWebhook (HMAC-SHA256 hex)", () => {
  const secret = "moyasar-secret";
  const body = JSON.stringify({ id: "pay_1", status: "paid" });
  const sign = (s: string, b: string) => createHmac("sha256", s).update(b, "utf8").digest("hex");

  it("accepts a valid signature regardless of case", () => {
    expect(verifyMoyasarWebhook(body, sign(secret, body), secret)).toBe(true);
    expect(verifyMoyasarWebhook(body, sign(secret, body).toUpperCase(), secret)).toBe(true);
  });
  it("rejects forged, missing, or secretless calls", () => {
    expect(verifyMoyasarWebhook(body, sign("nope", body), secret)).toBe(false);
    expect(verifyMoyasarWebhook(body, null, secret)).toBe(false);
    expect(verifyMoyasarWebhook(body, sign(secret, body), "")).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(verifyMoyasarWebhook(`${body}x`, sign(secret, body), secret)).toBe(false);
  });
});
