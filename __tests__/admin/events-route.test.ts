import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => ({ rpc }) }));
vi.mock("@/lib/auth/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/admin")>()),
  requirePlatformAdminApi: vi.fn(async () => ({ id: "admin" }))
}));

import { GET } from "@/app/api/admin/events/route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/events?${qs}`));

beforeEach(() => rpc.mockReset());

describe("GET /api/admin/events (F27)", () => {
  it("searches through the admin_search_events function with trimmed filters", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ id: 7, kind: "social.inbound", merchant: "m1", payload: {}, created_at: "2026-11-06T00:00:00Z", total_count: 41 }],
      error: null
    });
    const res = await get("search=%20refund%20&kind=social.inbound&limit=20&offset=20");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_search_events", {
      p_search: "refund",
      p_kind: "social.inbound",
      p_merchant: null,
      p_limit: 20,
      p_offset: 20
    });
    const body = (await res.json()) as { events: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(41);
    expect(body.events[0]).not.toHaveProperty("total_count");
  });

  it("rejects non-numeric or out-of-range paging instead of passing NaN to the database", async () => {
    expect((await get("limit=abc")).status).toBe(400);
    expect((await get("offset=-5")).status).toBe(400);
    expect((await get("limit=1000")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
