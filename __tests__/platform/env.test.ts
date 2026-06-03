import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getPlatformEnv,
  hydratePlatformEnvFromDatabase,
  invalidatePlatformEnvCache,
  isPlatformEnvHydrated
} from "@/lib/platform/env";

describe("platform env", () => {
  const original = process.env.CRON_SECRET;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    invalidatePlatformEnvCache();
    process.env.CRON_SECRET = "from-hpanel";
    // Pin the "DB unavailable" path deterministically: with no Supabase config the
    // service client throws immediately, so hydration falls back to process.env
    // without touching the network (otherwise this test flakes on the read latency).
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    invalidatePlatformEnvCache();
  });

  it("reads from process.env", () => {
    expect(getPlatformEnv("CRON_SECRET")).toBe("from-hpanel");
  });

  it("tracks hydration state", () => {
    expect(isPlatformEnvHydrated()).toBe(false);
  });

  it("hydrate completes without throwing when DB unavailable in test", async () => {
    await expect(hydratePlatformEnvFromDatabase()).resolves.toBeUndefined();
  });
});
