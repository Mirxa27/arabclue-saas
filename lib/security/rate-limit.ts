import { NextResponse } from "next/server";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();

function pruneMemory(now: number) {
  if (memory.size < 5000) return;
  for (const [key, bucket] of memory) {
    if (bucket.resetAt <= now) memory.delete(key);
  }
}

async function upstashIncr(key: string, windowSec: number): Promise<{ count: number; ttl: number } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redisKey = `rl:${key}`;
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["TTL", redisKey],
      ["EXPIRE", redisKey, windowSec, "NX"]
    ]),
    signal: AbortSignal.timeout(3000)
  }).catch(() => null);

  if (!res?.ok) return null;
  const body = (await res.json()) as Array<{ result: number }>;
  const count = body[0]?.result ?? 1;
  let ttl = body[1]?.result ?? -1;
  if (ttl < 0) ttl = windowSec;
  return { count, ttl };
}

/**
 * Sliding-window rate limiter — in-memory by default, Upstash Redis when configured.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  const redis = await upstashIncr(key, windowSec);
  if (redis) {
    const resetAt = now + redis.ttl * 1000;
    const remaining = Math.max(0, limit - redis.count);
    return { success: redis.count <= limit, limit, remaining, resetAt };
  }

  pruneMemory(now);
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, limit, remaining: limit - 1, resetAt: now + windowMs };
  }

  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return { success: bucket.count <= limit, limit, remaining, resetAt: bucket.resetAt };
}

// ─── Client IP ──────────────────────────────────────────────────────────────

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

/**
 * Number of reverse proxies in front of the app that *append* the connecting address to
 * X-Forwarded-For (TRUSTED_PROXY_HOPS, default 1 — Hostinger/Passenger, a single nginx).
 * 0 means nothing trustworthy sits in front: forwarding headers are ignored entirely.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) return DEFAULT_TRUSTED_PROXY_HOPS;
  return Math.min(hops, MAX_TRUSTED_PROXY_HOPS);
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;

/** Expand an IPv6 address to its eight 16-bit groups, or null when it is not one. */
export function expandIpv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  const tail: number[] = [];
  // Embedded IPv4 in the last 32 bits (e.g. ::ffff:192.0.2.1).
  const lastColon = addr.lastIndexOf(":");
  if (lastColon >= 0 && addr.slice(lastColon + 1).includes(".")) {
    const v4 = addr.slice(lastColon + 1);
    if (!IPV4_RE.test(v4)) return null;
    const [a, b, c, d] = v4.split(".").map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    addr = `${addr.slice(0, lastColon + 1)}0:0`; // placeholder groups, replaced below
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (![...head, ...rest].every((g) => HEXTET_RE.test(g))) return null;

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  const out = groups.map((g) => parseInt(g, 16));
  if (tail.length) out.splice(6, 2, ...tail);
  return out;
}

/** Canonical form of an IP address taken from a header (ports, brackets, zone ids stripped). */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.length > 64) return null;

  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));

  value = value.toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);

  if (IPV4_RE.test(value)) return value;
  const groups = expandIpv6(value);
  if (!groups) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the same client as a.b.c.d.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return groups.map((g) => g.toString(16)).join(":");
}

function firstEntry(header: string | null): string | null {
  return header?.split(",")[0]?.trim() || null;
}

/**
 * The client address for rate limiting — never the left-most X-Forwarded-For entry,
 * which any client can set.
 *
 * - On Vercel (`VERCEL=1`) the platform header `x-vercel-forwarded-for` / `x-real-ip`,
 *   which Vercel overwrites at its edge.
 * - Otherwise the X-Forwarded-For entry TRUSTED_PROXY_HOPS positions from the right: each
 *   trusted proxy appends the address it received the connection from, so that entry was
 *   written by our outermost proxy. Spoofed entries a client adds sit further left.
 * - Then `x-real-ip` (set, not appended, by nginx-style proxies), else "unknown".
 */
export function clientIp(req: Request): string {
  const headers = req.headers;

  if (process.env.VERCEL === "1") {
    const platform =
      normalizeIp(firstEntry(headers.get("x-vercel-forwarded-for"))) ?? normalizeIp(headers.get("x-real-ip"));
    if (platform) return platform;
  }

  const hops = trustedProxyHops();
  if (hops === 0) return "unknown";

  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length > 0) {
    // Fewer entries than hops: the outermost entry present is the best we have (express-style).
    const ip = normalizeIp(chain[Math.max(0, chain.length - hops)]);
    if (ip) return ip;
  }

  return normalizeIp(headers.get("x-real-ip")) ?? "unknown";
}

/**
 * Rate-limit subject for an address. IPv6 clients usually control a whole /64, so they are
 * bucketed per /64 rather than per address (otherwise rotating addresses bypasses limits).
 */
export function ipRateLimitSubject(ip: string): string {
  if (!ip.includes(":")) return ip;
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000))
  };
}

export type RateLimitKeyOptions = {
  /** Appended to the key (e.g. a normalised email or a webhook target id). */
  extraKey?: string;
  /**
   * Key the limit by this principal (an authenticated user or merchant id) instead of the
   * client IP: the budget follows the account, so shared NATs don't collide and rotating
   * IPs doesn't reset it.
   */
  identity?: string | null;
};

/** The bucket key for `scope`. A string `extra` keeps the historical `${scope}:${ip}:${extra}` shape. */
export function rateLimitKey(req: Request, scope: string, extra: string | RateLimitKeyOptions = ""): string {
  const opts: RateLimitKeyOptions = typeof extra === "string" ? { extraKey: extra } : extra;
  const subject = opts.identity ? `id:${opts.identity}` : ipRateLimitSubject(clientIp(req));
  return `${scope}:${subject}${opts.extraKey ? `:${opts.extraKey}` : ""}`;
}

export async function enforceRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number,
  extra: string | RateLimitKeyOptions = ""
): Promise<RateLimitResult | NextResponse> {
  const result = await rateLimit(rateLimitKey(req, scope, extra), limit, windowMs);
  if (!result.success) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(result) }
    );
  }
  return result;
}
