/**
 * F28 — Salla product sync: every write is checked (failure → 500, never "synced N"), only rows
 * the database returned are counted, pagination follows Salla's totalPages, and the route goes
 * through the token helper (409 with a stable code when Salla is not usable).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { HttpError } from "@/lib/api/errors";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

const deps = vi.hoisted(() => ({
  merchant: { id: "aaaaaaaa-0000-4000-8000-00000000000a" } as null | { id: string },
  sallaApiForMerchant: vi.fn()
}));
let userDb = createFakeSupabase("user");

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!deps.merchant) throw new actual.AuthError();
      return deps.merchant;
    })
  };
});
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServerSupabase: async () => userDb.client
}));
vi.mock("@/lib/salla/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salla/tokens")>()),
  sallaApiForMerchant: deps.sallaApiForMerchant
}));

import { syncSallaProducts } from "@/lib/salla/products-sync";
import { POST } from "@/app/api/salla/products/route";
import { SallaConnectionError } from "@/lib/salla/tokens";

const M = "aaaaaaaa-0000-4000-8000-00000000000a";
const product = (id: number, name = `P${id}`) => ({ id, name, price: { amount: 10 + id, currency: "SAR" }, quantity: 3 });
const page = (items: unknown[], totalPages?: number) => ({ data: items, ...(totalPages ? { pagination: { totalPages } } : {}) });

/** Echo upserted rows back (as PostgREST does with ?select=), optionally failing. */
function echoDb(opts: { fail?: boolean; dropLast?: boolean } = {}) {
  return createFakeSupabase("user", (call: FakeCall) => {
    if (call.table !== "salla_products" || call.op !== "upsert") return undefined;
    if (opts.fail) return { error: { code: "42501", message: "permission denied for table salla_products" } };
    const rows = (call.payload as Array<{ salla_product_id: string }>).map((r) => ({ salla_product_id: r.salla_product_id }));
    return { data: opts.dropLast ? rows.slice(0, -1) : rows };
  });
}

let ip = 0;
const request = () =>
  new NextRequest("http://localhost:3111/api/salla/products", { method: "POST", headers: { "x-forwarded-for": `192.0.2.${(ip = (ip % 250) + 1)}` } });

beforeEach(() => {
  deps.merchant = { id: M };
  deps.sallaApiForMerchant.mockReset();
  userDb = echoDb();
});

describe("syncSallaProducts", () => {
  it("counts only the rows the database wrote", async () => {
    const db = echoDb({ dropLast: true });
    const result = await syncSallaProducts({
      merchantId: M,
      db: db.client,
      fetchPage: async () => page([product(1), product(2)], 1)
    });
    expect(result).toEqual({ synced: 1, pages: 1, truncated: false });
    const upsert = db.calls.find((c) => c.op === "upsert");
    expect(upsert?.options).toEqual({ onConflict: "merchant_id,salla_product_id" });
    expect(upsert?.returning).toBe("salla_product_id");
    expect((upsert?.payload as Array<Record<string, unknown>>)[0]).toMatchObject({
      merchant_id: M,
      salla_product_id: "1",
      name: "P1",
      price: 11,
      inventory: 3
    });
  });

  it("fails with a 500 (and stops) when an upsert fails, instead of reporting success", async () => {
    const db = echoDb({ fail: true });
    const fetchPage = vi.fn(async () => page([product(1)], 3));
    const err = await syncSallaProducts({ merchantId: M, db: db.client, fetchPage }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 500, code: "db_write_failed" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("follows totalPages, flags truncation at the page cap and de-duplicates ids within a page", async () => {
    const db = echoDb();
    const fetchPage = vi.fn(async (n: number) => page([product(n), product(n)], 50));
    const result = await syncSallaProducts({ merchantId: M, db: db.client, fetchPage, maxPages: 3 });
    expect(result).toEqual({ synced: 3, pages: 3, truncated: true });
    expect((db.calls[0].payload as unknown[]).length).toBe(1);

    const short = await syncSallaProducts({
      merchantId: M,
      db: echoDb().client,
      fetchPage: async (n) => (n === 1 ? page([product(1)]) : page([])),
      perPage: 50
    });
    expect(short).toEqual({ synced: 1, pages: 1, truncated: false }); // fewer than perPage → last page
  });
});

describe("POST /api/salla/products", () => {
  it("syncs through the token helper and the merchant's own session", async () => {
    deps.sallaApiForMerchant.mockResolvedValue(page([product(1), product(2)], 1));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, synced: 2, pages: 1, truncated: false });
    expect(deps.sallaApiForMerchant).toHaveBeenCalledWith(M, "/products?per_page=50&page=1");
    expect(userDb.calls.every((c) => c.client === "user")).toBe(true);
  });

  it("returns 500 when the write fails", async () => {
    userDb = echoDb({ fail: true });
    deps.sallaApiForMerchant.mockResolvedValue(page([product(1)], 1));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sync Salla products failed" });
  });

  it("answers with the token layer's stable code when Salla is not usable", async () => {
    deps.sallaApiForMerchant.mockRejectedValue(
      new SallaConnectionError(409, "Salla access has expired. Reconnect your Salla store.", "salla_reconnect_required")
    );
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "salla_reconnect_required" });
  });

  it("requires a session", async () => {
    deps.merchant = null;
    expect((await POST(request())).status).toBe(401);
  });
});
