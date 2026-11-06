import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls: Call[] = [];
const rpc = vi.hoisted(() => vi.fn());
let countResult: { count: number | null; error: { message: string } | null } = { count: 3, error: null };
let listResult: { data: unknown[]; count: number; error: null | { message: string } } = { data: [], count: 0, error: null };

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({
    rpc,
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order", "range", "ilike", "limit"]) {
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => void) => {
        const isHeadCount = call.ops.some(([op, args]) => op === "select" && (args[1] as { head?: boolean })?.head);
        resolve(isHeadCount ? countResult : table === "social_channels" ? { data: [], error: null } : listResult);
      };
      return chain;
    }
  })
}));
vi.mock("@/lib/auth/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/admin")>()),
  requirePlatformAdminApi: vi.fn(async () => ({ id: "admin" }))
}));

import { getPlatformStats, listMerchantsAdmin } from "@/lib/admin/stats";
import { GET as listRoute } from "@/app/api/admin/merchants/route";

beforeEach(() => {
  calls.length = 0;
  rpc.mockReset();
  countResult = { count: 3, error: null };
  listResult = { data: [], count: 0, error: null };
});

describe("admin stats (#37)", () => {
  it("splits paying vs unpaid merchants from the exact SQL plan mix", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { plan: "lite", subscription_status: "pending", merchants: 1500 },
        { plan: "pro", subscription_status: "active", merchants: 7 },
        { plan: "pro", subscription_status: "past_due", merchants: 2 },
        { plan: "plus", subscription_status: "canceled", merchants: 4 }
      ],
      error: null
    });
    const stats = await getPlatformStats();
    expect(rpc).toHaveBeenCalledWith("admin_plan_mix");
    expect(stats.planCounts).toEqual({ pro: 9 });
    expect(stats.unpaidMerchants).toBe(1504);
  });

  it("surfaces count errors instead of reporting zeros", async () => {
    countResult = { count: null, error: { message: "statement timeout" } };
    await expect(getPlatformStats()).rejects.toThrow(/statement timeout/);
  });
});

describe("admin merchants list (#37)", () => {
  it("pages with an exact total and clamps the page size", async () => {
    listResult = { data: [{ id: "m1", seller_name: "a", access_token: "t" }], count: 237, error: null };
    const res = await listMerchantsAdmin({ limit: 500, offset: 100 });
    expect(res.total).toBe(237);
    expect(res.limit).toBe(100);
    const range = calls[0].ops.find(([op]) => op === "range");
    expect(range?.[1]).toEqual([100, 199]);
    expect(res.merchants[0]).toMatchObject({ id: "m1", sallaConnected: true });
    expect(JSON.stringify(res)).not.toContain('"t"'); // token value never returned
  });

  it("searches names literally and ids exactly", async () => {
    await listMerchantsAdmin({ q: "100%_off" });
    expect(calls[0].ops.find(([op]) => op === "ilike")?.[1]).toEqual(["seller_name", "%100\\%\\_off%"]);
    calls.length = 0;
    await listMerchantsAdmin({ q: "8f2c1d4e-7a3b-4c9d-8e1f-2a3b4c5d6e7f" });
    expect(calls[0].ops.find(([op]) => op === "eq")?.[1]).toEqual(["id", "8f2c1d4e-7a3b-4c9d-8e1f-2a3b4c5d6e7f"]);
  });

  it("validates query params on the route", async () => {
    expect((await listRoute(new NextRequest("http://localhost/api/admin/merchants?limit=abc"))).status).toBe(400);
    expect((await listRoute(new NextRequest("http://localhost/api/admin/merchants?limit=20&offset=40&q=oud"))).status).toBe(200);
  });
});
