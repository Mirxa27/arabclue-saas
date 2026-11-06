/**
 * RA-3 — hooks/use-merchant.ts runs in the browser on every dashboard page (Topbar mounts it
 * unconditionally). It used to `select("*")` from merchants, which downloaded the store's Salla
 * access/refresh tokens and the ZATCA CSID into the page. It must read the secret-free column
 * list, through the user's own browser session.
 *
 * The real hook runs on a minimal hooks runtime (useState slots, useCallback = identity, no
 * effects) because the suite has no DOM renderer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  return {
    slots,
    reset() {
      slots.length = 0;
      cursor = 0;
    },
    render() {
      cursor = 0;
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      const set = (value: unknown) => {
        slots[index] = typeof value === "function" ? (value as (v: unknown) => unknown)(slots[index]) : value;
      };
      return [slots[index], set];
    }
  };
});

const h = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  result: { data: { id: "m-1" } } as FakeResult
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: runtime.useState,
  useCallback: <T,>(fn: T) => fn,
  useEffect: () => undefined
}));
vi.mock("@/lib/db/supabase-browser", () => ({
  getBrowserSupabase: () => ({
    ...h.db.client,
    from: h.db.client.from,
    auth: { getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-0000000003b1" } }, error: null }) }
  })
}));

import { useMerchant } from "@/hooks/use-merchant";
import { MERCHANT_CLIENT_COLUMNS, MERCHANT_SECRET_COLUMNS } from "@/lib/merchant/columns";

beforeEach(() => {
  runtime.reset();
  h.result = { data: { id: "m-1", seller_name: "Store", plan: "plus" } };
  h.db = createFakeSupabase("browser", () => h.result);
});

describe("useMerchant", () => {
  it("loads the signed-in owner's merchant with the explicit, secret-free column list", async () => {
    runtime.render();
    await useMerchant().reload();
    runtime.render();
    const state = useMerchant();
    expect(state.merchant).toMatchObject({ id: "m-1", plan: "plus" });
    expect(state.error).toBeNull();

    const call = h.db.calls.find((c) => c.table === "merchants")!;
    expect(call.client).toBe("browser");
    expect(call.columns).toBe(MERCHANT_CLIENT_COLUMNS);
    for (const secret of MERCHANT_SECRET_COLUMNS) expect(call.columns).not.toContain(secret);
    expect(call.filters).toEqual([["eq", "owner_user_id", "00000000-0000-4000-8000-0000000003b1"]]);
  });

  it("reports a failed read instead of rendering a half-loaded merchant", async () => {
    h.result = { error: { code: "42501", message: "permission denied for table merchants" } };
    runtime.render();
    await useMerchant().reload();
    runtime.render();
    const state = useMerchant();
    expect(state.merchant).toBeNull();
    expect(state.error).toBeTruthy();
  });
});
