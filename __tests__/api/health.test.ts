import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(async () => ({ error: null as null | { message: string } })),
  isPlatformAdmin: vi.fn(async () => false),
  fetch: vi.fn()
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({ from: () => ({ select: () => ({ limit: mocks.limit }) }) })
}));
vi.mock("@/lib/auth/admin", () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock("@/lib/platform/env", () => ({ hydratePlatformEnvFromDatabase: vi.fn(async () => undefined) }));

import { GET } from "@/app/api/health/route";
import { resetPublicHealthCache } from "@/lib/health/checks";

const get = (headers: Record<string, string> = {}) =>
  GET(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}`, ...headers } }));

beforeEach(() => {
  vi.clearAllMocks();
  resetPublicHealthCache();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("MOYASAR_SECRET_KEY", "sk_test_x");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
});

describe("GET /api/health", () => {
  it("publicly returns only {ok,timestamp} and never calls third-party APIs", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["ok", "timestamp"]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("caches the public database probe", async () => {
    await get();
    await get();
    expect(mocks.limit).toHaveBeenCalledTimes(1);
  });

  it("reports 503 publicly without leaking the database error", async () => {
    mocks.limit.mockResolvedValueOnce({ error: { message: "password authentication failed for user x" } });
    const res = await get();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("password");
  });

  it("gives operators the detailed report with the cron secret", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await get({ authorization: "Bearer cron-secret-value" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: Record<string, { ok: boolean }> };
    expect(Object.keys(body.checks).sort()).toEqual(["moyasar", "openai", "supabase"]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not treat a missing CRON_SECRET as authorization", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await get({ authorization: "Bearer " });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.checks).toBeUndefined();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("gives platform admins the detailed report", async () => {
    mocks.isPlatformAdmin.mockResolvedValueOnce(true);
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const body = (await (await get()).json()) as Record<string, unknown>;
    expect(body.checks).toBeDefined();
  });
});
