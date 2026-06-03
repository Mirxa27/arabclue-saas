import { describe, it, expect, vi, afterEach } from "vitest";
import { redactSensitive, redactDeep, reportError } from "@/lib/observability/error-reporter";

afterEach(() => vi.restoreAllMocks());

describe("redactSensitive", () => {
  it("scrubs the credential but keeps the auth scheme", () => {
    const out = redactSensitive("Authorization: Bearer sk-LIVE-deadbeef123456 was rejected");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).not.toContain("deadbeef123456");
  });

  it("scrubs JWTs / Supabase service-role keys", () => {
    const jwt = "eyJhbGciOiJI.eyJyb2xlIjoic2VydmljZSI.s3rv1ce_r0le_signature";
    expect(redactSensitive(`key=${jwt}`)).not.toContain("eyJhbGciOiJI");
  });

  it("scrubs key=value secrets, emails, and phone numbers", () => {
    expect(redactSensitive("access_token=supersecretvalue123")).toBe("access_token=[REDACTED]");
    expect(redactSensitive("reach me at buyer@store.sa now")).toBe("reach me at [REDACTED] now");
    expect(redactSensitive("called +966500000000 today")).toBe("called [REDACTED] today");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSensitive("order 123 created for merchant 9")).toBe("order 123 created for merchant 9");
  });
});

describe("redactDeep", () => {
  it("drops sensitive-named keys wholesale and scrubs nested strings", () => {
    const json = JSON.stringify(
      redactDeep({
        api_key: "sk-LIVE-shouldVanish999",
        note: "ping a@b.com",
        nested: { authorization: "Bearer xyz12345678", ok: "fine" }
      })
    );
    expect(json).not.toContain("shouldVanish999");
    expect(json).not.toContain("a@b.com");
    expect(json).not.toContain("xyz12345678");
    expect(json).toContain("[REDACTED]");
    expect(json).toContain('"ok":"fine"'); // non-sensitive values preserved
  });
});

describe("reportError redacts before anything leaves the process", () => {
  it("never logs a secret or PII present in the error message or extra context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const priorDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN; // keep it to the local log path

    reportError(new Error("salla rejected: Bearer sk-LIVE-deadbeefcafe42"), {
      route: "/api/salla/webhook",
      merchantId: "11111111-1111-1111-1111-111111111111",
      extra: { api_key: "sk-LIVE-anotherSecret777", customerEmail: "buyer@store.sa" }
    });

    const logged = String(spy.mock.calls[0]?.[0]);
    expect(logged).not.toContain("deadbeefcafe42");
    expect(logged).not.toContain("anotherSecret777");
    expect(logged).not.toContain("buyer@store.sa");
    expect(logged).toContain("[REDACTED]");
    // Non-sensitive context is still useful for debugging.
    expect(logged).toContain("/api/salla/webhook");
    expect(logged).toContain("11111111-1111-1111-1111-111111111111");

    if (priorDsn !== undefined) process.env.SENTRY_DSN = priorDsn;
  });
});
