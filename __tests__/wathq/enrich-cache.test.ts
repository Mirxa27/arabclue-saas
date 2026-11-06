/**
 * critic-1: wathq_cache is service-role only (RLS on, no Data API grants) — enrichCR
 * must read and write it with the service client, and never trust a malformed row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ service: null as unknown as FakeSupabase }));
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("wathq_cache is not reachable through the user's session");
  }
}));

import { enrichCR } from "@/lib/wathq/client";

const fresh = { crNumber: "1010101010", crEntityName: "شركة الاختبار", crEntityStatus: "active" };
const fetchMock = vi.fn();

function useService(handler: FakeHandler) {
  h.service = createFakeSupabase("service", handler);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("enrichCR", () => {
  it("serves a fresh cache hit without calling Wathq", async () => {
    useService(() => ({ data: { payload: fresh, fetched_at: new Date().toISOString() } }));
    expect(await enrichCR("1010101010", "key")).toEqual(fresh);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.service.calls[0]).toMatchObject({ table: "wathq_cache", op: "select", client: "service" });
  });

  it("refetches and caches with the service role when the cached row is stale or malformed", async () => {
    useService((call) => (call.op === "select" ? { data: { payload: { crEntityStatus: "forged" }, fetched_at: new Date().toISOString() } } : undefined));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fresh), { status: 200 }));
    expect(await enrichCR("1010101010", "key")).toEqual(fresh);
    const [upsert] = h.service.writes();
    expect(upsert).toMatchObject({ table: "wathq_cache", op: "upsert", client: "service" });
    expect(upsert.payload).toMatchObject({ cr_number: "1010101010", payload: fresh });
  });
});
