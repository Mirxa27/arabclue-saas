/**
 * RA-3 / RA-9 — lib/auth/session.ts reads the signed-in user's merchant with the shared,
 * secret-free column list (getCurrentMerchant feeds requireMerchant/requireMerchantApi and is
 * serialised into every server-rendered dashboard page through PageShell). A failed lookup
 * (e.g. 42501 after a grant/column-list mismatch) is an error, not "this user has no merchant".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  user: { id: "00000000-0000-4000-8000-0000000003a1" } as null | { id: string },
  result: { data: { id: "m-1" } } as FakeResult
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => ({ ...h.db.client, from: h.db.client.from, auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  getServiceSupabase: () => {
    throw new Error("session helpers must use the user's own session");
  }
}));

import { getCurrentMerchant, getSessionContext, requireMerchantApi } from "@/lib/auth/session";
import { MERCHANT_CLIENT_COLUMNS, MERCHANT_SECRET_COLUMNS } from "@/lib/merchant/columns";

beforeEach(() => {
  h.user = { id: "00000000-0000-4000-8000-0000000003a1" };
  h.result = { data: { id: "m-1", seller_name: "Store" } };
  h.db = createFakeSupabase("user", () => h.result);
});

function merchantSelect() {
  const call = h.db.calls.find((c) => c.table === "merchants");
  expect(call).toBeDefined();
  return call!;
}

describe.each([
  ["getCurrentMerchant", () => getCurrentMerchant()],
  ["getSessionContext", async () => (await getSessionContext()).merchant]
])("%s", (_name, load) => {
  it("selects the explicit client columns for the session's own row — never * or a credential", async () => {
    await expect(load()).resolves.toMatchObject({ id: "m-1" });
    const call = merchantSelect();
    expect(call.columns).toBe(MERCHANT_CLIENT_COLUMNS);
    for (const secret of MERCHANT_SECRET_COLUMNS) expect(call.columns).not.toContain(secret);
    expect(call.filters).toEqual([["eq", "owner_user_id", "00000000-0000-4000-8000-0000000003a1"]]);
  });

  it("returns null when the user has no merchant row", async () => {
    h.result = { data: null };
    await expect(load()).resolves.toBeNull();
  });

  it("throws when the lookup fails instead of reporting 'no merchant'", async () => {
    h.result = { error: { code: "42501", message: "permission denied for table merchants" } };
    await expect(load()).rejects.toThrow(/merchant lookup failed/);
  });
});

it("requireMerchantApi surfaces a failed lookup as an error, not a 403 'complete onboarding'", async () => {
  h.result = { error: { code: "42501", message: "permission denied for table merchants" } };
  await expect(requireMerchantApi()).rejects.toThrow(/merchant lookup failed/);
});
