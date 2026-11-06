/**
 * RA-6: isSameOriginRequest behind a proxy / self-hosted Next.
 *
 * On `next start` or a custom server (Hostinger/Passenger) req.url carries the server's own
 * host:port (http://localhost:3000), never the public host, so comparing Origin with req.url
 * alone rejected every sign-in unless NEXT_PUBLIC_SITE_URL was already set. The Host /
 * X-Forwarded-Host the proxy sends identify the public host instead; browsers cannot set either
 * on a cross-site request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeOriginCheck, isSameOriginRequest } from "@/lib/security/same-origin";

const INTERNAL = "http://localhost:3000/api/auth/otp";

function post(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSameOriginRequest without NEXT_PUBLIC_SITE_URL", () => {
  it("accepts the public origin when it matches X-Forwarded-Host (proxy, internal req.url)", () => {
    const req = post(INTERNAL, {
      origin: "https://arabclue.example",
      host: "localhost:3000",
      "x-forwarded-host": "arabclue.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin"
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("accepts the public origin when only the Host header carries it", () => {
    expect(isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example", host: "arabclue.example" }))).toBe(true);
  });

  it("uses only the first X-Forwarded-Host entry and ignores case and default ports", () => {
    expect(
      isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example", "x-forwarded-host": "Arabclue.Example:443, internal:3000" }))
    ).toBe(true);
    expect(
      isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example", "x-forwarded-host": "internal:3000, arabclue.example" }))
    ).toBe(false);
  });

  it("compares hosts, so a proxy that drops X-Forwarded-Proto still works", () => {
    // Origin is https while the internal request is plain http.
    expect(isSameOriginRequest(post("http://arabclue.example/api/auth/otp", { origin: "https://arabclue.example", host: "arabclue.example" }))).toBe(
      true
    );
  });

  it("keeps a non-default port significant", () => {
    expect(isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example:8443", host: "arabclue.example" }))).toBe(false);
    expect(isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example:8443", host: "arabclue.example:8443" }))).toBe(true);
  });

  it.each([
    ["a foreign origin", { origin: "https://evil.example", host: "arabclue.example", "x-forwarded-host": "arabclue.example" }],
    ["a sibling subdomain", { origin: "https://evil.arabclue.example", host: "arabclue.example" }],
    ["a suffix trick", { origin: "https://arabclue.example.evil.example", host: "arabclue.example" }],
    ["no Origin header", { host: "arabclue.example" }],
    ["Origin: null", { origin: "null", host: "arabclue.example" }],
    ["a malformed Origin", { origin: "arabclue.example", host: "arabclue.example" }],
    ["cross-site fetch metadata", { origin: "https://arabclue.example", host: "arabclue.example", "sec-fetch-site": "cross-site" }],
    ["same-site fetch metadata", { origin: "https://arabclue.example", host: "arabclue.example", "sec-fetch-site": "same-site" }]
  ])("rejects %s", (_label, headers) => {
    expect(isSameOriginRequest(post(INTERNAL, headers as Record<string, string>))).toBe(false);
  });

  it("still accepts the request's own origin (local dev, Vercel)", () => {
    expect(isSameOriginRequest(post("http://localhost:3111/api/auth/otp", { origin: "http://localhost:3111", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
});

describe("isSameOriginRequest with NEXT_PUBLIC_SITE_URL", () => {
  it("accepts the configured site origin even when the proxy forwards no host", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://arabclue.example/");
    expect(isSameOriginRequest(post(INTERNAL, { origin: "https://arabclue.example" }))).toBe(true);
    expect(isSameOriginRequest(post(INTERNAL, { origin: "https://www.arabclue.example" }))).toBe(false);
  });
});

describe("describeOriginCheck", () => {
  it("explains a rejection without secrets (for the server log)", () => {
    const detail = describeOriginCheck(
      post(INTERNAL, { origin: "https://evil.example", host: "localhost:3000", "x-forwarded-host": "arabclue.example", "sec-fetch-site": "cross-site" })
    );
    expect(detail).toEqual({
      origin: "https://evil.example",
      secFetchSite: "cross-site",
      host: "localhost:3000",
      forwardedHost: "arabclue.example",
      allowedOrigins: ["http://localhost:3000"]
    });
  });
});
