/**
 * SW-26 — GET /api/wathq/[cr] spends the platform's Wathq allowance only when it must:
 *  - the admin "Wathq enrichment" switch is honoured (503, nothing read or fetched);
 *  - CR format, plan and configuration are checked before any spend;
 *  - per-merchant burst limit (IP rotation does not reset it) and a daily cap in a
 *    service-role counter, claimed only for real upstream calls (cache hits are free);
 *  - unknown CRs are cached (negative cache), the fetch has a timeout, and an unexpected
 *    Wathq response is a reported 502 — not a 400 that blames the merchant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMemoryDb } from "../helpers/memory-db";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb>,
  merchant: null as Merchant | null,
  features: { billing: true, zatca: true, wathq: true, socialOAuth: true },
  claimAllowed: true
}));
const reportError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/observability/error-reporter", () => ({ reportError }));
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.db.client,
  getServerSupabase: async () => {
    throw new Error("Wathq data is service-role only");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  const { HttpError } = await import("@/lib/api/errors");
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
      return h.merchant;
    })
  };
});

import { GET } from "@/app/api/wathq/[cr]/route";
import { NOT_FOUND_TTL_HOURS } from "@/lib/wathq/client";

let seq = 0;
function merchant(plan: Merchant["plan"] = "pro"): Merchant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    salla_merchant_id: null,
    store_url: null,
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    token_expires_at: null,
    plan,
    subscription_status: "active",
    owner_user_id: "u1",
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null
  };
}

const fetchMock = vi.fn();
const CR = "1010101010";
const SUMMARY = { crNumber: CR, crEntityName: "شركة الاختبار", crEntityStatus: "active" };

function lookup(cr: string, ip = "203.0.113.10") {
  return GET(new NextRequest(`http://localhost/api/wathq/${cr}`, { headers: { "x-forwarded-for": ip } }), {
    params: Promise.resolve({ cr })
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  reportError.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.WATHQ_API_KEY = "wathq-key";
  h.merchant = merchant();
  h.features = { billing: true, zatca: true, wathq: true, socialOAuth: true };
  h.claimAllowed = true;
  // The real platform-settings module reads the admin switches from this table.
  h.db = createMemoryDb(
    { platform_settings: [{ key: "features", value: h.features }] },
    {
      rpc: (fn) => (fn === "claim_merchant_usage" ? { data: { allowed: h.claimAllowed, used: 1, limit: 500 } } : undefined),
      override: (call, tables) => {
        // wathq_cache is keyed by cr_number: emulate upsert
        if (call.table === "wathq_cache" && call.op === "upsert") {
          const row = call.payload as Record<string, unknown>;
          tables.wathq_cache = [...(tables.wathq_cache ?? []).filter((r) => r.cr_number !== row.cr_number), row];
          return { data: null };
        }
        return undefined;
      }
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WATHQ_API_KEY;
});

describe("gates before any spend", () => {
  it("503 when the admin switched Wathq enrichment off — no cache read, no upstream call", async () => {
    h.db.table("platform_settings")[0].value = { ...h.features, wathq: false };
    const res = await lookup(CR);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Wathq enrichment is disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.db.calls.map((c) => c.table)).toEqual(["platform_settings"]);
    expect(h.db.rpcCalls).toEqual([]);
  });

  it("400 for a malformed CR, 402 without a Wathq plan, 503 when not configured", async () => {
    expect((await lookup("12345")).status).toBe(400);
    expect((await lookup("10101010ab")).status).toBe(400);
    h.merchant = merchant("plus");
    expect((await lookup(CR)).status).toBe(402);
    h.merchant = merchant("pro");
    delete process.env.WATHQ_API_KEY;
    const res = await lookup(CR);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts Arabic-Indic digits", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(SUMMARY), { status: 200 }));
    const res = await lookup("١٠١٠١٠١٠١٠");
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain(`/info/${CR}`);
  });
});

describe("spend controls", () => {
  it("rate-limits per merchant (30/min) even when the IP changes", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(SUMMARY), { status: 200 }));
    for (let i = 0; i < 30; i += 1) {
      const res = await lookup(String(2000000000 + i), `198.51.100.${i % 250}`);
      expect(res.status).toBe(200);
    }
    expect((await lookup("2000000099", "192.0.2.1")).status).toBe(429);
  });

  it("claims the daily cap only for upstream calls, and 429s without calling Wathq when it is used up", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(SUMMARY), { status: 200 }));
    expect((await lookup(CR)).status).toBe(200);
    expect(h.db.rpcCalls.map((c) => c.fn)).toEqual(["claim_merchant_usage"]);
    expect(h.db.rpcCalls[0].args).toMatchObject({ p_metric: "wathq.lookup", p_limit: 500, p_merchant_id: h.merchant!.id });

    // cache hit: free
    expect((await lookup(CR)).status).toBe(200);
    expect(h.db.rpcCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    h.claimAllowed = false;
    const res = await lookup("3000000000");
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches a not-found CR: 25 repeats of an unknown number make ONE upstream call", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    for (let i = 0; i < 25; i += 1) expect((await lookup("4000000000")).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.db.table("wathq_cache")).toEqual([expect.objectContaining({ cr_number: "4000000000", payload: { notFound: true } })]);
  });

  it("an expired negative-cache entry is looked up again", async () => {
    h.db.table("wathq_cache").push({
      cr_number: "5000000000",
      payload: { notFound: true },
      fetched_at: new Date(Date.now() - (NOT_FOUND_TTL_HOURS + 1) * 3_600_000).toISOString()
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...SUMMARY, crNumber: "5000000000" }), { status: 200 }));
    expect((await lookup("5000000000")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a timeout signal with the Wathq request", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(SUMMARY), { status: 200 }));
    await lookup(CR);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("upstream failures", () => {
  it("an unexpected response shape is a reported 502, not a 400", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ cr: CR, name: "renamed fields" }), { status: 200 }));
    const res = await lookup(CR);
    expect(res.status).toBe(502);
    expect(reportError).toHaveBeenCalled();
    expect(h.db.table("wathq_cache")).toEqual([]);
  });

  it("a timeout is a 504 and a Wathq 429 a 503", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));
    expect((await lookup(CR)).status).toBe(504);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }));
    expect((await lookup("6000000000")).status).toBe(503);
  });
});
