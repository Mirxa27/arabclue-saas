/**
 * F30 — the rate limiter must not key on the client-controlled left-most X-Forwarded-For entry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  clientIp,
  enforceRateLimit,
  ipRateLimitSubject,
  normalizeIp,
  rateLimitKey,
  trustedProxyHops
} from "@/lib/security/rate-limit";

const req = (headers: Record<string, string>) => new Request("https://arabclue.com/api/auth/otp", { headers });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp", () => {
  it("defaults to one trusted hop: the right-most X-Forwarded-For entry", () => {
    // Client sent "X-Forwarded-For: 1.1.1.1"; Passenger appended the real peer address.
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("cannot be steered by rotating spoofed entries", () => {
    const seen = new Set(
      ["10.0.0.1", "10.0.0.2", "8.8.8.8, 9.9.9.9", "evil"].map((spoof) =>
        clientIp(req({ "x-forwarded-for": `${spoof}, 203.0.113.9` }))
      )
    );
    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("honours TRUSTED_PROXY_HOPS counted from the right", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    // spoofed, real client, CDN edge (appended by the origin proxy)
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 172.68.1.1" }))).toBe("198.51.100.4");
    // Fewer entries than hops: the outermost one present.
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("ignores forwarding headers when TRUSTED_PROXY_HOPS=0", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }))).toBe("unknown");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({ "x-forwarded-for": "garbage", "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("uses Vercel's platform header on Vercel and ignores it elsewhere", () => {
    const headers = { "x-vercel-forwarded-for": "198.51.100.20", "x-forwarded-for": "1.1.1.1, 76.76.21.21" };
    expect(clientIp(req(headers))).toBe("76.76.21.21"); // not on Vercel: header is client-settable
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(req(headers))).toBe("198.51.100.20");
    expect(clientIp(req({ "x-real-ip": "198.51.100.21" }))).toBe("198.51.100.21");
  });

  it("parses invalid TRUSTED_PROXY_HOPS as the default", () => {
    for (const bad of ["", "abc", "-1", "1.5"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", bad);
      expect(trustedProxyHops()).toBe(1);
    }
    vi.stubEnv("TRUSTED_PROXY_HOPS", "99");
    expect(trustedProxyHops()).toBe(10);
  });
});

describe("normalizeIp", () => {
  it("strips ports, brackets and zone ids and canonicalises IPv6", () => {
    expect(normalizeIp("203.0.113.9:51234")).toBe("203.0.113.9");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8:0:0:0:0:0:1");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0:0:0:0:1");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
  });

  it("rejects non-addresses", () => {
    for (const bad of ["", "unknown", "999.1.1.1", "1.2.3", "2001:::1", "1:2:3:4:5:6:7:8:9", "<script>"]) {
      expect(normalizeIp(bad)).toBeNull();
    }
  });
});

describe("rate-limit keys", () => {
  it("keeps the historical key shape for IPv4 + string extraKey", () => {
    expect(rateLimitKey(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }), "auth:otp:login", "a@b.co")).toBe(
      "auth:otp:login:203.0.113.9:a@b.co"
    );
  });

  it("buckets IPv6 clients per /64", () => {
    expect(ipRateLimitSubject("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    const a = rateLimitKey(req({ "x-forwarded-for": "2001:db8:1:2::1" }), "s");
    const b = rateLimitKey(req({ "x-forwarded-for": "2001:db8:1:2:ffff::9" }), "s");
    expect(a).toBe(b);
  });

  it("keys authenticated limits by identity instead of IP", () => {
    const k1 = rateLimitKey(req({ "x-forwarded-for": "203.0.113.1" }), "billing:intent", { identity: "merchant-1" });
    const k2 = rateLimitKey(req({ "x-forwarded-for": "198.51.100.2" }), "billing:intent", { identity: "merchant-1" });
    expect(k1).toBe("billing:intent:id:merchant-1");
    expect(k2).toBe(k1);
  });

  it("enforceRateLimit blocks a spoof-rotating client once the real address is over the limit", async () => {
    const scope = `test:spoof:${Math.random()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await enforceRateLimit(req({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.50` }), scope, 3, 60_000);
      statuses.push(res instanceof NextResponse ? res.status : 200);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
