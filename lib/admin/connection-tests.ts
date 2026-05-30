import { z } from "zod";
import { hydratePlatformEnvFromDatabase } from "@/lib/platform/env";
import { getServiceSupabase } from "@/lib/db/supabase";
import { aiText } from "@/lib/ai/providers";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";
import { SALLA_AUTH_BASE } from "@/lib/salla/oauth";
import type { ConnectionTestResult, TestableService } from "@/lib/admin/types";

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

async function testAnthropic(): Promise<ConnectionTestResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "ANTHROPIC_API_KEY not configured" };
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }]
        }),
        signal: AbortSignal.timeout(20_000)
      });
      if (!res.ok && res.status !== 400) throw new Error(`HTTP ${res.status}`);
    });
    return { ok: true, message: "Anthropic API reachable", latencyMs };
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
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return { ok: false, message: "META_APP_ID / META_APP_SECRET missing" };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${process.env.META_APP_ID}?fields=id&access_token=${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
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
  const base = process.env.ZATCA_FATOORA_BASE;
  if (!base) return { ok: false, message: "ZATCA_FATOORA_BASE not configured" };
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

async function testCron(): Promise<ConnectionTestResult> {
  const secret = process.env.CRON_SECRET;
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret) return { ok: false, message: "CRON_SECRET missing" };
  if (!base) return { ok: false, message: "NEXT_PUBLIC_SITE_URL missing" };
  try {
    const { result, latencyMs } = await timed(async () => {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/social-scheduler`, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(60_000)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return text;
    });
    return { ok: true, message: "Social cron endpoint OK", latencyMs, detail: result.slice(0, 200) };
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
