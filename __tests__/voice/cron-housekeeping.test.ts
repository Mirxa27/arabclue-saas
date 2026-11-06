/**
 * SW-45 / SW-22: the employees-tick cron runs the voice housekeeping (30-day retention, lapsed
 * number release, release retries) and reports it; a voice failure never fails the tick.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as FakeSupabase, housekeeping: vi.fn() }));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/employees/billing-cycle", () => ({ enforceEmployeeBillingCycle: vi.fn(async () => ({ charged: 0 })) }));
vi.mock("@/lib/employees/runtime", () => ({ tick: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/employees/tick-queue", () => ({ runTickQueue: vi.fn(async () => ({ results: [], deferred: [] })) }));
vi.mock("@/lib/webhooks/idempotency", () => ({ pruneWebhookEvents: vi.fn(async () => 0) }));
vi.mock("@/lib/voice/housekeeping", () => ({ runVoiceHousekeeping: h.housekeeping }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { GET } from "@/app/api/cron/employees-tick/route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret-value";
  h.db = createFakeSupabase("service", () => undefined, (fn) => (fn === "next_employees_to_tick" ? { data: [] } : { data: 0 }));
  h.housekeeping.mockResolvedValue({ pruned: { events: 3, calls: 1, releases: 0 }, lapsed: null, releases: { released: 0, failed: 0 }, errors: 0 });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("employees-tick runs the voice housekeeping", () => {
  it("calls it once with the service client and reports the result", async () => {
    const res = await GET(new NextRequest("https://arabclue.test/api/cron/employees-tick", { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(res.status).toBe(200);
    expect(h.housekeeping).toHaveBeenCalledTimes(1);
    expect(h.housekeeping).toHaveBeenCalledWith(h.db.client);
    expect(((await res.json()) as { voice: unknown }).voice).toMatchObject({ pruned: { events: 3, calls: 1 } });
  });

  it("is not reachable without the cron secret", async () => {
    const res = await GET(new NextRequest("https://arabclue.test/api/cron/employees-tick"));
    expect(res.status).toBe(401);
    expect(h.housekeeping).not.toHaveBeenCalled();
  });
});
