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

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000))
  };
}

export async function enforceRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number,
  extraKey = ""
): Promise<RateLimitResult | NextResponse> {
  const ip = clientIp(req);
  const key = `${scope}:${ip}${extraKey ? `:${extraKey}` : ""}`;
  const result = await rateLimit(key, limit, windowMs);
  if (!result.success) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(result) }
    );
  }
  return result;
}
