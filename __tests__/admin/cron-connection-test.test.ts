/**
 * SW-14: the admin "Social cron" connection test must never run the production publisher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/env", () => ({ hydratePlatformEnvFromDatabase: vi.fn(async () => undefined) }));

import { testConnection } from "@/lib/admin/connection-tests";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://arabclue.com/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("admin cron connection test", () => {
  it("calls the read-only probe (never the scheduler) and checks that auth is enforced", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, probe: true, socialAgentEnabled: true, due: 2 }))
      .mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    const result = await testConnection("cron");
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("nothing published") });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "https://arabclue.com/api/cron/social-scheduler/probe",
      "https://arabclue.com/api/cron/social-scheduler/probe"
    ]);
    expect(urls.some((u) => u.endsWith("/api/cron/social-scheduler"))).toBe(false);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
    expect(fetchMock.mock.calls[1][1]?.headers).toBeUndefined();
  });

  it("fails on a deployment without the probe instead of falling back to the publisher", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await testConnection("cron");
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("deploy the current version") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails when the endpoint answers without the secret", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, probe: true, socialAgentEnabled: true, due: 0 }))
      .mockResolvedValueOnce(json({ ok: true, probe: true }, 200));
    expect(await testConnection("cron")).toMatchObject({ ok: false, message: expect.stringContaining("without CRON_SECRET") });
  });

  it("surfaces a probe failure (e.g. the migration is missing)", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, probe: true, error: "social publishing migration (20261106005500) not applied" }, 503));
    expect(await testConnection("cron")).toMatchObject({ ok: false, message: expect.stringContaining("migration") });
  });
});
