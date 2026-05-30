import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getPlatformEnv,
  hydratePlatformEnvFromDatabase,
  invalidatePlatformEnvCache,
  isPlatformEnvHydrated
} from "@/lib/platform/env";

describe("platform env", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    invalidatePlatformEnvCache();
    process.env.CRON_SECRET = "from-hpanel";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
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
