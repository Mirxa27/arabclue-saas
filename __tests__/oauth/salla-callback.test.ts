/**
 * F12 / F16 for the Salla Custom Mode connect flow:
 *  - GET /api/salla/oauth/start mints a "salla" state for the session's merchant with the auth
 *    stream's nonce cookie and redirects to accounts.salla.sa with offline_access;
 *  - the callback only exchanges the code for a "salla" state + this browser's nonce + the state's
 *    merchant signed in, resolves the store id, and links it through salla_link_store with the
 *    tokens ENCRYPTED; a store owned by another merchant → store_already_linked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setCookies } from "../helpers/fake-gotrue";
import { createFakeSupabase, type FakeResult } from "../helpers/fake-supabase";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth/state";
import { newOAuthNonce } from "@/lib/oauth/flow-cookie";
import { decryptSecret } from "@/lib/crypto/secrets";

const MERCHANT = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a" };

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  merchant: null as null | { id: string; owner_user_id: string }
}));
const salla = vi.hoisted(() => ({
  exchangeCodeForTokens: vi.fn(),
  fetchSallaUserInfo: vi.fn(),
  fetchSallaStoreInfo: vi.fn()
}));
const rpc = vi.hoisted(() => ({ result: null as null | ((fn: string, args: Record<string, unknown>) => FakeResult) }));
let service = createFakeSupabase("service");

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/agents/store-server", () => ({ updateAgentStatus: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: auth.user, merchant: auth.merchant }))
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));
vi.mock("@/lib/salla/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salla/oauth")>()),
  exchangeCodeForTokens: salla.exchangeCodeForTokens,
  fetchSallaUserInfo: salla.fetchSallaUserInfo,
  fetchSallaStoreInfo: salla.fetchSallaStoreInfo
}));

import { GET as start } from "@/app/api/salla/oauth/start/route";
import { GET as callback } from "@/app/api/salla/oauth/callback/route";

const SITE = "http://localhost:3111";
let ip = 0;
const nextIp = () => `198.51.100.${(ip = (ip % 250) + 1)}`;

function signIn(merchant: typeof MERCHANT | null, { withMerchant = true } = {}) {
  auth.user = merchant ? { id: merchant.owner_user_id } : null;
  auth.merchant = merchant && withMerchant ? merchant : null;
}

/** A state + matching flow cookie as the start route would mint them. */
function sallaFlow(merchantId = MERCHANT.id, platform: "salla" | "linkedin" = "salla") {
  const nonce = newOAuthNonce();
  return { state: createOAuthState({ merchantId, platform, nonce }), cookie: `ac_oauth_salla=${nonce}` };
}

const callCallback = (query: Record<string, string>, cookie?: string) =>
  callback(
    new NextRequest(`${SITE}/api/salla/oauth/callback?${new URLSearchParams(query)}`, {
      headers: cookie ? { cookie } : {}
    })
  );

const linkCalls = () => service.rpcCalls.filter((c) => c.fn === "salla_link_store");

beforeEach(() => {
  vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  vi.stubEnv("SALLA_CLIENT_ID", "salla-id");
  vi.stubEnv("SALLA_CLIENT_SECRET", "salla-secret");
  vi.stubEnv("SALLA_REDIRECT_URI", `${SITE}/api/salla/oauth/callback`);
  signIn(MERCHANT);
  rpc.result = () => ({ data: { outcome: "linked", merchant_id: MERCHANT.id } });
  service = createFakeSupabase("service", () => undefined, (fn, args) => rpc.result?.(fn, args));
  salla.exchangeCodeForTokens.mockReset().mockResolvedValue({
    access_token: "salla-access",
    refresh_token: "salla-refresh",
    expires_in: 1209600,
    token_type: "bearer"
  });
  salla.fetchSallaUserInfo.mockReset().mockResolvedValue({
    storeId: "777",
    storeName: "Bait Al Oud",
    storeDomain: "https://bait-al-oud.example",
    userEmail: "owner@example.com",
    userRole: "user"
  });
  salla.fetchSallaStoreInfo.mockReset().mockRejectedValue(new Error("not called"));
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/salla/oauth/start", () => {
  const callStart = (base = SITE, headers: Record<string, string> = {}) =>
    start(new NextRequest(`${base}/api/salla/oauth/start`, { headers: { "x-forwarded-for": nextIp(), ...headers } }));

  it("redirects to Salla with a salla state for the session merchant and sets the nonce cookie", async () => {
    const res = await callStart();
    const location = new URL(res.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://accounts.salla.sa/oauth2/auth");
    expect(location.searchParams.get("client_id")).toBe("salla-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${SITE}/api/salla/oauth/callback`);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("offline_access");

    const state = verifyOAuthState(location.searchParams.get("state") ?? "");
    expect(state).toMatchObject({ platform: "salla", merchantId: MERCHANT.id });
    const cookie = setCookies(res).get("ac_oauth_salla");
    expect(cookie?.value).toBe(state.nonce);
    expect(cookie?.raw).toMatch(/HttpOnly/i);
    expect(cookie?.raw).toMatch(/SameSite=Lax/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("uses a __Host- Secure cookie on https", async () => {
    const res = await callStart("https://arabclue.example");
    const cookie = setCookies(res).get("__Host-ac_oauth_salla");
    expect(cookie?.raw).toMatch(/Secure/i);
  });

  it("sends signed-out visitors to login and users without a merchant to onboarding", async () => {
    signIn(null);
    expect((await callStart()).headers.get("location")).toBe("/login?next=%2Fapi%2Fsalla%2Foauth%2Fstart");
    signIn(MERCHANT, { withMerchant: false });
    expect((await callStart()).headers.get("location")).toBe("/welcome");
  });

  it("reports not_configured instead of sending the merchant to a flow that cannot finish", async () => {
    vi.stubEnv("SALLA_CLIENT_SECRET", "");
    const res = await callStart();
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=salla&status=error&error=not_configured");
    expect(setCookies(res).get("ac_oauth_salla")).toBeUndefined();
  });

  it("start → callback round trip links the store with the cookie the start route set", async () => {
    const started = await callStart();
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const nonce = setCookies(started).get("ac_oauth_salla")?.value;
    const res = await callCallback({ code: "c1", state }, `ac_oauth_salla=${nonce}`);
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=salla&status=success");
    expect(linkCalls()).toHaveLength(1);
  });
});

describe("GET /api/salla/oauth/callback", () => {
  it("links the store to the signed-in merchant with the tokens encrypted at rest", async () => {
    const before = Date.now();
    const { state, cookie } = sallaFlow();
    const res = await callCallback({ code: "c1", state }, cookie);

    expect(res.headers.get("location")).toBe("/integrations/callback?platform=salla&status=success");
    expect(salla.exchangeCodeForTokens).toHaveBeenCalledWith(
      expect.objectContaining({ code: "c1", clientId: "salla-id", clientSecret: "salla-secret" })
    );
    const [link] = linkCalls();
    expect(link.args).toMatchObject({ p_merchant_id: MERCHANT.id, p_salla_merchant_id: "777", p_store_name: "Bait Al Oud" });
    // never plaintext in the written row
    expect(String(link.args.p_access_token)).toMatch(/^enc:v1:/);
    expect(String(link.args.p_refresh_token)).toMatch(/^enc:v1:/);
    expect(decryptSecret(String(link.args.p_access_token))).toBe("salla-access");
    expect(decryptSecret(String(link.args.p_refresh_token))).toBe("salla-refresh");
    const expiresAt = Date.parse(String(link.args.p_expires_at));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 1209600 * 1000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 1209600 * 1000 + 1000);
    // only the service role writes; nothing touched merchants directly
    expect(service.calls).toHaveLength(0);
    expect(setCookies(res).get("ac_oauth_salla")?.raw).toMatch(/Max-Age=0/);
  });

  it("rejects a state minted for another platform even with this browser's nonce", async () => {
    const { state, cookie } = sallaFlow(MERCHANT.id, "linkedin");
    const location = (await callCallback({ code: "c", state }, cookie)).headers.get("location");
    expect(location).toBe("/integrations/callback?platform=salla&status=error&error=bad_state");
    expect(salla.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(linkCalls()).toHaveLength(0);
  });

  it("rejects a state without this browser's nonce cookie or for another merchant", async () => {
    const { state } = sallaFlow();
    expect((await callCallback({ code: "c", state }, `ac_oauth_salla=${newOAuthNonce()}`)).headers.get("location")).toContain(
      "error=state_mismatch"
    );
    expect((await callCallback({ code: "c", state })).headers.get("location")).toContain("error=state_mismatch");
    const other = sallaFlow("bbbbbbbb-0000-4000-8000-00000000000b");
    expect((await callCallback({ code: "c", state: other.state }, other.cookie)).headers.get("location")).toContain(
      "error=merchant_mismatch"
    );
    expect(salla.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(linkCalls()).toHaveLength(0);
  });

  it("reports a store linked to another merchant as store_already_linked (function outcome or 23505)", async () => {
    rpc.result = () => ({ data: { outcome: "store_already_linked" } });
    let flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toBe(
      "/integrations/callback?platform=salla&status=error&error=store_already_linked"
    );

    rpc.result = () => ({
      error: { code: "23505", message: 'duplicate key value violates unique constraint "merchants_salla_merchant_id_key"' }
    });
    flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toBe(
      "/integrations/callback?platform=salla&status=error&error=store_already_linked"
    );
  });

  it("reports save_failed when the merchant row is gone or the write fails, instead of claiming success", async () => {
    rpc.result = () => ({ data: { outcome: "merchant_not_found" } });
    let flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toContain("error=save_failed");

    rpc.result = () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toContain("error=save_failed");
  });

  it("falls back to /store/info for the store id, and fails honestly when neither lookup works", async () => {
    salla.fetchSallaUserInfo.mockRejectedValue(new Error("user/info 503"));
    salla.fetchSallaStoreInfo.mockResolvedValue({ storeId: "888", storeName: "Fallback", storeDomain: null, userEmail: null, userRole: null });
    let flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toContain("status=success");
    expect(linkCalls()[0].args).toMatchObject({ p_salla_merchant_id: "888" });

    salla.fetchSallaStoreInfo.mockRejectedValue(new Error("store/info 401"));
    flow = sallaFlow();
    expect((await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location")).toBe(
      "/integrations/callback?platform=salla&status=error&error=account_lookup_failed"
    );
    expect(linkCalls()).toHaveLength(1);
  });

  it("uses stable codes for missing params, bad state, token exchange and missing config", async () => {
    expect((await callCallback({ state: "x" })).headers.get("location")).toContain("error=missing_code_or_state");
    expect((await callCallback({ code: "c", state: "garbage.sig" })).headers.get("location")).toContain("error=bad_state");
    expect((await callCallback({ error: "access_denied", state: "x" })).headers.get("location")).toContain("error=provider_denied");

    salla.exchangeCodeForTokens.mockRejectedValueOnce(new Error("Salla token exchange failed: 401"));
    let flow = sallaFlow();
    let location = (await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location");
    expect(location).toBe("/integrations/callback?platform=salla&status=error&error=token_exchange_failed");

    vi.stubEnv("SALLA_CLIENT_SECRET", "");
    flow = sallaFlow();
    location = (await callCallback({ code: "c", state: flow.state }, flow.cookie)).headers.get("location");
    expect(location).toContain("error=not_configured");
    expect(linkCalls()).toHaveLength(0);
  });
});
