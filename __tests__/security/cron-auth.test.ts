import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertCronAuthorized, cronAuthorization, isCronAuthorized } from "@/lib/security/cron";

const SECRET = "cr0n-s3cret-value";
const URL_BASE = "https://app.arabclue.com/api/cron/employees-tick";

const reqWith = (headers: Record<string, string>, url = URL_BASE): NextRequest =>
  new NextRequest(url, { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCronAuthorized", () => {
  it("accepts Authorization: Bearer <secret>", () => {
    expect(isCronAuthorized(reqWith({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
  });

  it("accepts the x-cron-secret header", () => {
    expect(isCronAuthorized(reqWith({ "x-cron-secret": SECRET }), SECRET)).toBe(true);
  });

  it("compares against the trimmed configured secret (hPanel values may carry a trailing newline)", () => {
    expect(isCronAuthorized(reqWith({ authorization: `Bearer ${SECRET}` }), `${SECRET}\n`)).toBe(true);
  });

  it("rejects a wrong or missing secret", () => {
    expect(isCronAuthorized(reqWith({ authorization: "Bearer wrong" }), SECRET)).toBe(false);
    expect(isCronAuthorized(reqWith({ "x-cron-secret": "wrong" }), SECRET)).toBe(false);
    expect(isCronAuthorized(reqWith({}), SECRET)).toBe(false);
  });

  it("does NOT accept a secret passed in the query string", () => {
    const req = new NextRequest(`${URL_BASE}?secret=${SECRET}`, { headers: {} });
    expect(isCronAuthorized(req, SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured outside next dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isCronAuthorized(reqWith({}), undefined)).toBe(false);
    expect(isCronAuthorized(reqWith({}), "")).toBe(false);
    expect(isCronAuthorized(reqWith({}), "   ")).toBe(false);
    expect(cronAuthorization(reqWith({ authorization: "Bearer anything" }), undefined)).toBe("not_configured");
    vi.stubEnv("NODE_ENV", "test");
    expect(isCronAuthorized(reqWith({}), undefined)).toBe(false);
  });

  it("allows an unset secret only under next dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isCronAuthorized(reqWith({}), undefined)).toBe(true);
    expect(isCronAuthorized(reqWith({}), "")).toBe(true);
    // A configured secret is still enforced in development.
    expect(isCronAuthorized(reqWith({}), SECRET)).toBe(false);
  });
});

describe("assertCronAuthorized", () => {
  it("answers 503 not_configured when CRON_SECRET is unset in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    const res = assertCronAuthorized(reqWith({ authorization: "Bearer guess" }));
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: "CRON_SECRET is not configured", code: "not_configured" });
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 for a wrong secret and null for the right one", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const denied = assertCronAuthorized(reqWith({ authorization: "Bearer wrong" }));
    expect(denied?.status).toBe(401);
    expect(await denied?.json()).toEqual({ error: "unauthorized" });
    expect(assertCronAuthorized(reqWith({ authorization: `Bearer ${SECRET}` }))).toBeNull();
    expect(assertCronAuthorized(reqWith({ "x-cron-secret": SECRET }))).toBeNull();
  });
});
