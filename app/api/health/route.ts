import { NextResponse } from "next/server";
import { hydratePlatformEnvFromDatabase } from "@/lib/platform/env";
import { getServiceSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = { ok: boolean; latencyMs?: number; message?: string };

async function timedCheck(fn: () => Promise<void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "check failed"
    };
  }
}

async function checkSupabase(): Promise<CheckResult> {
  return timedCheck(async () => {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("merchants").select("id").limit(1);
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

export async function GET() {
  try {
    await hydratePlatformEnvFromDatabase();
    const [supabase, moyasar, openai] = await Promise.all([
      checkSupabase(),
      checkMoyasar(),
      checkOpenAI()
    ]);

    const checks = { supabase, moyasar, openai };
    const ok = Object.values(checks).every((c) => c.ok);
    const gitSha =
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_SHA ??
      process.env.COMMIT_SHA ??
      "dev";

    return NextResponse.json(
      {
        ok,
        version: process.env.npm_package_version ?? "0.1.0",
        gitSha,
        timestamp: new Date().toISOString(),
        checks
      },
      { status: ok ? 200 : 503 }
    );
  } catch (err) {
    reportError(err, { route: "/api/health" });
    return NextResponse.json({ ok: false, error: "health check failed" }, { status: 500 });
  }
}
