import { z } from "zod";
import { hydratePlatformEnvFromDatabase } from "@/lib/platform/env";
import { getServiceSupabase } from "@/lib/db/supabase";
import { aiText } from "@/lib/ai/providers";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";
import { SALLA_AUTH_BASE } from "@/lib/salla/oauth";
import { graphUrl } from "@/lib/meta/graph";
import type { ConnectionTestResult, TestableService } from "@/lib/admin/types";
import { getZatcaConfig } from "@/lib/zatca/config";

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

export async function testConnection(service: TestableService): Promise<ConnectionTestResult> {
  await hydratePlatformEnvFromDatabase();
  switch (service) {
    case "supabase":
      return testSupabase();
    case "openai":
      return testOpenAI();
    case "anthropic":
      return testAnthropic();
    case "salla":
      return testSalla();
    case "meta":
      return testMeta();
    case "linkedin":
      return testLinkedIn();
    case "x":
      return testX();
    case "tiktok":
      return testTikTok();
    case "moyasar":
      return testMoyasar();
    case "wathq":
      return testWathq();
    case "zatca":
      return testZatca();
    case "cron":
      return testCron();
    case "oauth":
      return testOAuthState();
    case "social_engager":
      return testSocialEngager();
    default:
      return { ok: false, message: `Unknown service: ${service}` };
  }
}

async function testSupabase(): Promise<ConnectionTestResult> {
  try {
    const { result, latencyMs } = await timed(async () => {
      const supabase = getServiceSupabase();
      const { error } = await supabase.from("merchants").select("id").limit(1);
      if (error) throw new Error(error.message);
      return true;
    });
    return { ok: result, message: "Supabase reachable (service role)", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Supabase test failed" };
  }
}

async function testOpenAI(): Promise<ConnectionTestResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, message: "OPENAI_API_KEY not configured" };
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
    return { ok: true, message: "OpenAI API reachable", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "OpenAI test failed" };
  }
}

/**
 * Validates the Anthropic API key with the Models endpoint (GET /v1/models):
 * no model id to go stale and no tokens spent. The old check posted a message to
 * a hard-coded model and counted HTTP 400 as success, so a malformed request
 * passed while a valid key against a retired model id failed.
 */
async function testAnthropic(): Promise<ConnectionTestResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "ANTHROPIC_API_KEY not configured" };
  try {
    const { result: res, latencyMs } = await timed(() =>
      fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2026-10-21" },
        signal: AbortSignal.timeout(15_000)
      })
    );
    if (res.status === 401) return { ok: false, message: "Anthropic rejected the API key (401)", latencyMs };
    if (res.status === 403) return { ok: false, message: "Anthropic API key is not permitted to list models (403)", latencyMs };
    if (!res.ok) return { ok: false, message: `Anthropic API error: HTTP ${res.status}`, latencyMs };
    return { ok: true, message: "Anthropic API key valid", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Anthropic test failed" };
  }
}

async function testSalla(): Promise<ConnectionTestResult> {
  if (!process.env.SALLA_CLIENT_ID || !process.env.SALLA_CLIENT_SECRET) {
    return { ok: false, message: "SALLA_CLIENT_ID / SALLA_CLIENT_SECRET missing" };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch(`${SALLA_AUTH_BASE}/oauth2/auth`, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000)
      }).catch(() => fetch(SALLA_AUTH_BASE, { signal: AbortSignal.timeout(10_000) }));
      if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
    });
    return { ok: true, message: "Salla OAuth host reachable; credentials present", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Salla test failed" };
  }
}

async function testMeta(): Promise<ConnectionTestResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, message: "META_APP_ID / META_APP_SECRET missing" };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch(
        graphUrl([appId], { fields: "id", access_token: `${appId}|${appSecret}` }),
        { signal: AbortSignal.timeout(15_000) }
      );
      const json = z.object({ id: z.string().optional(), error: z.object({ message: z.string() }).optional() }).parse(await res.json());
      if (json.error) throw new Error(json.error.message);
      if (!json.id) throw new Error("Invalid Meta app response");
    });
    return { ok: true, message: "Meta app credentials valid", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Meta test failed" };
  }
}

async function testLinkedIn(): Promise<ConnectionTestResult> {
  if (!process.env.LINKEDIN_CLIENT_ID) {
    return { ok: false, message: "LINKEDIN_CLIENT_ID missing" };
  }
  return { ok: true, message: "LinkedIn OAuth client ID configured (full test requires user redirect)" };
}

async function testX(): Promise<ConnectionTestResult> {
  if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET) {
    return { ok: false, message: "X_CLIENT_ID / X_CLIENT_SECRET missing" };
  }
  return { ok: true, message: "X OAuth credentials configured (full test requires user redirect)" };
}

async function testTikTok(): Promise<ConnectionTestResult> {
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    return { ok: false, message: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET missing" };
  }
  return { ok: true, message: "TikTok OAuth credentials configured (full test requires user redirect)" };
}

async function testMoyasar(): Promise<ConnectionTestResult> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) return { ok: false, message: "MOYASAR_SECRET_KEY missing" };
  try {
    const { latencyMs } = await timed(async () => {
      const auth = Buffer.from(`${key}:`).toString("base64");
      const res = await fetch("https://api.moyasar.com/v1/payments?limit=1", {
        headers: { authorization: `Basic ${auth}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok && res.status !== 401) throw new Error(`HTTP ${res.status}`);
      if (res.status === 401) throw new Error("Invalid Moyasar secret key");
    });
    return { ok: true, message: "Moyasar API authenticated", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Moyasar test failed" };
  }
}

async function testWathq(): Promise<ConnectionTestResult> {
  const key = process.env.WATHQ_API_KEY;
  if (!key) return { ok: false, message: "WATHQ_API_KEY not configured (optional)" };
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch("https://api.wathq.sa/v5/commercialregistration/info/1010000000", {
        headers: { apikey: key, accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    });
    return { ok: true, message: "Wathq API reachable", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Wathq test failed" };
  }
}

async function testZatca(): Promise<ConnectionTestResult> {
  let base: string;
  try {
    const cfg = getZatcaConfig();
    if (!cfg) return { ok: false, message: "ZATCA_ENVIRONMENT not configured" };
    base = cfg.baseUrl;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "ZATCA configuration invalid" };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(10_000) }).catch(() =>
        fetch(base, { signal: AbortSignal.timeout(10_000) })
      );
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    });
    return { ok: true, message: "ZATCA Fatoora base reachable", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "ZATCA test failed" };
  }
}

/**
 * SW-14: a connection test must never run the production publisher. This calls the scheduler's
 * read-only probe (same cron auth, a database read, no claims, nothing published) and checks
 * that the probe refuses a request without the secret. An old deployment without the probe
 * answers 404 here instead of publishing merchants' posts.
 */
async function testCron(): Promise<ConnectionTestResult> {
  const secret = process.env.CRON_SECRET?.trim();
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!secret) return { ok: false, message: "CRON_SECRET missing" };
  if (!base) return { ok: false, message: "NEXT_PUBLIC_SITE_URL missing" };
  const url = `${base.replace(/\/$/, "")}/api/cron/social-scheduler/probe`;
  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15_000)
      });
      const text = await res.text();
      if (res.status === 404) throw new Error("Cron probe endpoint not found — deploy the current version");
      let body: { probe?: unknown; ok?: unknown; error?: unknown } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        /* reported below */
      }
      if (body.probe !== true) throw new Error(`HTTP ${res.status}: not a probe response`);
      if (!res.ok || body.ok !== true) {
        throw new Error(`HTTP ${res.status}: ${typeof body.error === "string" ? body.error : "probe failed"}`);
      }

      const anonymous = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      await anonymous.text().catch(() => "");
      if (anonymous.status !== 401) throw new Error(`Cron endpoint accepted a request without CRON_SECRET (HTTP ${anonymous.status})`);
      return text;
    });
    return { ok: true, message: "Social cron reachable (probe only — nothing published)", latencyMs, detail: result.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Cron test failed" };
  }
}

async function testOAuthState(): Promise<ConnectionTestResult> {
  try {
    const state = createOAuthState({
      merchantId: "00000000-0000-4000-8000-000000000001",
      platform: "instagram"
    });
    verifyOAuthState(state);
    return { ok: true, message: "OAuth state signing works" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "OAuth state test failed" };
  }
}

async function testSocialEngager(): Promise<ConnectionTestResult> {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: "Configure OPENAI_API_KEY or ANTHROPIC_API_KEY for engager" };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const reply = await aiText({
        system: "Reply with exactly: pong",
        prompt: "ping",
        maxTokens: 10,
        temperature: 0
      });
      if (!reply.toLowerCase().includes("pong")) throw new Error("Unexpected AI response");
    });
    return { ok: true, message: "Engager AI provider responded", latencyMs };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Engager test failed" };
  }
}

export async function testAllConnections(): Promise<Record<TestableService, ConnectionTestResult>> {
  const results = {} as Record<TestableService, ConnectionTestResult>;
  for (const service of [
    "supabase",
    "openai",
    "anthropic",
    "salla",
    "meta",
    "linkedin",
    "x",
    "tiktok",
    "moyasar",
    "wathq",
    "zatca",
    "cron",
    "oauth",
    "social_engager"
  ] as TestableService[]) {
    results[service] = await testConnection(service);
  }
  return results;
}
