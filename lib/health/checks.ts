/**
 * Health checks. The public probe is a cheap, cached database ping that never
 * touches third-party APIs or reveals configuration; the detailed report
 * (Supabase + Moyasar + OpenAI reachability with error text) is for operators.
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import { hydratePlatformEnvFromDatabase } from "@/lib/platform/env";

export type CheckResult = { ok: boolean; latencyMs?: number; message?: string };

async function timedCheck(fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, message: err instanceof Error ? err.message : "check failed" };
  }
}

export function checkSupabase(): Promise<CheckResult> {
  return timedCheck(async () => {
    const { error } = await getServiceSupabase().from("merchants").select("id").limit(1);
    if (error) throw new Error(error.message);
  });
}

async function checkMoyasar(): Promise<CheckResult> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) return { ok: false, message: "MOYASAR_SECRET_KEY not configured" };
  return timedCheck(async () => {
    const res = await fetch("https://api.moyasar.com/v1/payments?limit=1", {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

async function checkOpenAI(): Promise<CheckResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, message: "OPENAI_API_KEY not configured" };
  return timedCheck(async () => {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

export type DetailedHealth = {
  ok: boolean;
  version: string;
  gitSha: string;
  timestamp: string;
  checks: { supabase: CheckResult; moyasar: CheckResult; openai: CheckResult };
};

export async function detailedHealth(): Promise<DetailedHealth> {
  await hydratePlatformEnvFromDatabase();
  const [supabase, moyasar, openai] = await Promise.all([checkSupabase(), checkMoyasar(), checkOpenAI()]);
  const checks = { supabase, moyasar, openai };
  return {
    ok: Object.values(checks).every((c) => c.ok),
    version: process.env.npm_package_version ?? "0.1.0",
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? process.env.COMMIT_SHA ?? "dev",
    timestamp: new Date().toISOString(),
    checks
  };
}

const PUBLIC_TTL_MS = 30_000;
let publicCache: { ok: boolean; at: number } | null = null;

/** Liveness + database reachability only; cached per instance so probes cannot hammer the DB. */
export async function publicHealth(now: number = Date.now()): Promise<{ ok: boolean; timestamp: string }> {
  if (!publicCache || now - publicCache.at >= PUBLIC_TTL_MS) {
    const db = await checkSupabase();
    publicCache = { ok: db.ok, at: now };
  }
  return { ok: publicCache.ok, timestamp: new Date(now).toISOString() };
}

/** Test hook. */
export function resetPublicHealthCache(): void {
  publicCache = null;
}
