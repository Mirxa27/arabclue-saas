/**
 * F16 + critic-21 for the Salla OAuth callback: browser/merchant binding before the code
 * exchange, stable error codes, and the merchant row update actually checked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setCookies } from "../helpers/fake-gotrue";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";
import { createOAuthState } from "@/lib/oauth/state";
import { newOAuthNonce } from "@/lib/oauth/flow-cookie";

const MERCHANT = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a" };

const auth = vi.hoisted(() => ({ merchant: null as null | { id: string; owner_user_id: string } }));
const db = vi.hoisted(() => ({ results: {} as Record<string, QueryResult> }));
const salla = vi.hoisted(() => ({ exchangeCodeForTokens: vi.fn(), sallaAPI: vi.fn() }));
let service = fakeSupabase({});

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/agents/store-server", () => ({ updateAgentStatus: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({
    user: auth.merchant ? { id: auth.merchant.owner_user_id } : null,
    merchant: auth.merchant
  }))
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));
vi.mock("@/lib/salla/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salla/oauth")>()),
  exchangeCodeForTokens: salla.exchangeCodeForTokens,
  sallaAPI: salla.sallaAPI
}));

import { GET } from "@/app/api/salla/oauth/callback/route";

const SITE = "http://localhost:3111";

function sallaFlow(merchantId = MERCHANT.id) {
  const nonce = newOAuthNonce();
  return { state: createOAuthState({ merchantId, platform: "salla", nonce }), cookie: `ac_oauth_salla=${nonce}` };
}

const call = (query: Record<string, string>, cookie?: string) =>
  GET(
    new NextRequest(`${SITE}/api/salla/oauth/callback?${new URLSearchParams(query)}`, {
      headers: cookie ? { cookie } : {}
    })
  );

beforeEach(() => {
  vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
  vi.stubEnv("SALLA_CLIENT_ID", "salla-id");
  vi.stubEnv("SALLA_CLIENT_SECRET", "salla-secret");
  vi.stubEnv("SALLA_REDIRECT_URI", `${SITE}/api/salla/oauth/callback`);
  auth.merchant = MERCHANT;
  db.results = { merchants: { data: [{ id: MERCHANT.id }], error: null } };
  service = fakeSupabase(db.results);
  salla.exchangeCodeForTokens.mockReset().mockResolvedValue({
    access_token: "salla-access",
    refresh_token: "salla-refresh",
    expires_in: 1209600,
    token_type: "bearer"
  });
  salla.sallaAPI.mockReset().mockResolvedValue({ data: { id: 777, name: "Bait Al Oud" } });
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/salla/oauth/callback", () => {
  it("stores the tokens on the signed-in merchant when cookie + state + session match", async () => {
    const { state, cookie } = sallaFlow();
    const res = await call({ code: "c1", state }, cookie);

    expect(res.headers.get("location")).toBe("/integrations/callback?platform=salla&status=success");
    const update = service.calls.find((c) => c.table === "merchants" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ salla_merchant_id: "777", seller_name: "Bait Al Oud", access_token: "salla-access" });
    expect(service.calls.find((c) => c.method === "eq")?.args).toEqual(["id", MERCHANT.id]);
    expect(setCookies(res).get("ac_oauth_salla")?.raw).toMatch(/Max-Age=0/);
  });

  it("rejects a state without this browser's nonce cookie or for another merchant", async () => {
    const { state } = sallaFlow();
    expect((await call({ code: "c", state }, `ac_oauth_salla=${newOAuthNonce()}`)).headers.get("location")).toContain(
      "error=state_mismatch"
    );
    const other = sallaFlow("bbbbbbbb-0000-4000-8000-00000000000b");
    expect((await call({ code: "c", state: other.state }, other.cookie)).headers.get("location")).toContain(
      "error=merchant_mismatch"
    );
    expect(salla.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it("reports a store linked to another merchant as store_already_linked", async () => {
    db.results.merchants = {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "merchants_salla_merchant_id_key"' }
    };
    const { state, cookie } = sallaFlow();
    const location = (await call({ code: "c", state }, cookie)).headers.get("location");
    expect(location).toBe("/integrations/callback?platform=salla&status=error&error=store_already_linked");
  });

  it("reports save_failed when no merchant row was updated, instead of claiming success", async () => {
    db.results.merchants = { data: [], error: null };
    const { state, cookie } = sallaFlow();
    expect((await call({ code: "c", state }, cookie)).headers.get("location")).toContain("error=save_failed");
  });

  it("uses stable codes for missing params, bad state, token exchange and missing config", async () => {
    expect((await call({ state: "x" })).headers.get("location")).toContain("error=missing_code_or_state");
    expect((await call({ code: "c", state: "garbage.sig" })).headers.get("location")).toContain("error=bad_state");

    salla.exchangeCodeForTokens.mockRejectedValueOnce(new Error("Salla token exchange failed: 401"));
    let flow = sallaFlow();
    let location = (await call({ code: "c", state: flow.state }, flow.cookie)).headers.get("location");
    expect(location).toBe("/integrations/callback?platform=salla&status=error&error=token_exchange_failed");

    vi.stubEnv("SALLA_CLIENT_SECRET", "");
    flow = sallaFlow();
    location = (await call({ code: "c", state: flow.state }, flow.cookie)).headers.get("location");
    expect(location).toContain("error=not_configured");
  });
});
