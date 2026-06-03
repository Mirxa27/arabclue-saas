import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/security/cron";

const SECRET = "cr0n-s3cret-value";
const URL_BASE = "https://app.arabclue.com/api/cron/employees-tick";

const reqWith = (headers: Record<string, string>, url = URL_BASE): NextRequest =>
  new NextRequest(url, { headers });

describe("isCronAuthorized", () => {
  it("accepts Authorization: Bearer <secret>", () => {
    expect(isCronAuthorized(reqWith({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true);
  });

  it("accepts the x-cron-secret header", () => {
    expect(isCronAuthorized(reqWith({ "x-cron-secret": SECRET }), SECRET)).toBe(true);
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

  it("allows the call only when no secret is configured (local dev)", () => {
    expect(isCronAuthorized(reqWith({}), undefined)).toBe(true);
    expect(isCronAuthorized(reqWith({}), "")).toBe(true);
  });
});
