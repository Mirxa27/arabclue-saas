/**
 * F16 / critic-21 / UI-003 — merchant-level OAuth (LinkedIn, X, Meta):
 *  - start routes are browser navigations (signed out → /login?next=…) and set an httpOnly
 *    flow cookie holding the state nonce (+ PKCE verifier);
 *  - callbacks require cookie nonce == state.nonce and session merchant == state.merchantId
 *    BEFORE exchanging the code, and only ever redirect with stable error codes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { setCookies } from "../helpers/fake-gotrue";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";

const MERCHANT_A = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a" };
const MERCHANT_B = { id: "bbbbbbbb-0000-4000-8000-00000000000b", owner_user_id: "user-b" };

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  merchant: null as null | { id: string; owner_user_id: string }
}));
const db = vi.hoisted(() => ({ results: {} as Record<string, QueryResult> }));
const providers = vi.hoisted(() => ({
  exchangeLinkedInCode: vi.fn(),
  resolveLinkedInActorUrn: vi.fn(),
  exchangeXCode: vi.fn(),
  resolveXUserId: vi.fn(),
  exchangeMetaCode: vi.fn(),
  resolveInstagramAccount: vi.fn(),
  resolveWhatsAppPhoneId: vi.fn(),
  updateAgentStatus: vi.fn()
}));
const reportError = vi.hoisted(() => vi.fn());
let service = fakeSupabase({});

vi.mock("@/lib/observability/error-reporter", () => ({ reportError }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: auth.user, merchant: auth.merchant })),
  getCurrentMerchant: vi.fn(async () => auth.merchant)
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));
vi.mock("@/lib/agents/store-server", () => ({ updateAgentStatus: providers.updateAgentStatus }));
vi.mock("@/lib/linkedin/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/linkedin/oauth")>()),
  exchangeLinkedInCode: providers.exchangeLinkedInCode,
  resolveLinkedInActorUrn: providers.resolveLinkedInActorUrn
}));
vi.mock("@/lib/x/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/x/oauth")>()),
  exchangeXCode: providers.exchangeXCode,
  resolveXUserId: providers.resolveXUserId
}));
vi.mock("@/lib/meta/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/oauth")>()),
  exchangeMetaCode: providers.exchangeMetaCode,
  resolveInstagramAccount: providers.resolveInstagramAccount,
  resolveWhatsAppPhoneId: providers.resolveWhatsAppPhoneId
}));

import { GET as linkedinStart } from "@/app/api/oauth/linkedin/start/route";
import { GET as linkedinCallback } from "@/app/api/oauth/linkedin/callback/route";
import { GET as xStart } from "@/app/api/oauth/x/start/route";
import { GET as xCallback } from "@/app/api/oauth/x/callback/route";
import { GET as metaStart } from "@/app/api/oauth/meta/start/route";
import { GET as metaCallback } from "@/app/api/oauth/meta/callback/route";

const SITE = "http://localhost:3111";
let ip = 0;
const nextIp = () => `203.0.113.${(ip = (ip % 250) + 1)}`;

function signIn(merchant: typeof MERCHANT_A | null) {
  auth.user = merchant ? { id: merchant.owner_user_id } : null;
  auth.merchant = merchant;
}

function decodeState(state: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
}

async function start(handler: (req: NextRequest) => Promise<Response>, path: string, base = SITE) {
  const res = await handler(new NextRequest(`${base}${path}`, { headers: { "x-forwarded-for": nextIp() } }));
  const location = res.headers.get("location") ?? "";
  const state = location.startsWith("http") ? new URL(location).searchParams.get("state") ?? "" : "";
  return { res, location, state, cookies: setCookies(res) };
}

function callback(handler: (req: NextRequest) => Promise<Response>, path: string, query: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams(query).toString();
  return handler(new NextRequest(`${SITE}${path}?${qs}`, { headers: cookie ? { cookie } : {} }));
}

beforeEach(() => {
  vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  for (const [k, v] of Object.entries({
    LINKEDIN_CLIENT_ID: "li-id",
    LINKEDIN_CLIENT_SECRET: "li-secret",
    X_CLIENT_ID: "x-id",
    X_CLIENT_SECRET: "x-secret",
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret"
  })) vi.stubEnv(k, v);
  signIn(MERCHANT_A);
  db.results = { social_channels: { error: null } };
  service = fakeSupabase(db.results);
  Object.values(providers).forEach((fn) => fn.mockReset());
  reportError.mockReset();
  providers.exchangeLinkedInCode.mockResolvedValue({ access_token: "li-access", refresh_token: "li-refresh", expires_in: 3600 });
  providers.resolveLinkedInActorUrn.mockResolvedValue("urn:li:organization:42");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth start routes", () => {
  it("send signed-out visitors to /login?next=<start URL incl. query>", async () => {
    signIn(null);
    const { res, location } = await start(metaStart, "/api/oauth/meta/start?target=whatsapp");
    expect(res.status).toBe(303);
    expect(location).toBe(`/login?next=${encodeURIComponent("/api/oauth/meta/start?target=whatsapp")}`);
  });

  it("send users without a merchant profile to onboarding", async () => {
    auth.user = { id: "user-new" };
    auth.merchant = null;
    expect((await start(linkedinStart, "/api/oauth/linkedin/start")).location).toBe("/welcome");
  });

  it("report a missing app honestly instead of a JSON 503", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    const { location } = await start(linkedinStart, "/api/oauth/linkedin/start");
    expect(location).toBe("/integrations/callback?platform=linkedin&status=error&error=not_configured");
  });

  it("set an httpOnly SameSite=Lax flow cookie holding the state nonce", async () => {
    const { res, location, state, cookies } = await start(linkedinStart, "/api/oauth/linkedin/start");
    expect(res.status).toBe(307);
    expect(location).toMatch(/^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?/);
    const payload = decodeState(state);
    expect(payload.merchantId).toBe(MERCHANT_A.id);
    const cookie = cookies.get("ac_oauth_linkedin");
    expect(cookie?.value).toBe(payload.nonce);
    expect(cookie?.raw).toMatch(/HttpOnly/i);
    expect(cookie?.raw).toMatch(/SameSite=Lax/i);
    expect(cookie?.raw).toMatch(/Max-Age=600/);
    expect(cookie?.raw).not.toMatch(/Secure/i); // plain http (local dev)
  });

  it("use a Secure __Host- cookie on https", async () => {
    const { cookies } = await start(linkedinStart, "/api/oauth/linkedin/start", "https://arabclue.com");
    const cookie = cookies.get("__Host-ac_oauth_linkedin");
    expect(cookie?.raw).toMatch(/Secure/i);
    expect(cookie?.raw).toMatch(/Path=\//);
    expect(cookies.has("ac_oauth_linkedin")).toBe(false);
  });

  it("keep the PKCE verifier in the cookie and only send its challenge (X)", async () => {
    const { location, state, cookies } = await start(xStart, "/api/oauth/x/start");
    const [nonce, verifier] = (cookies.get("ac_oauth_x")?.value ?? "").split(".");
    expect(nonce).toBe(decodeState(state).nonce);
    const challenge = new URL(location).searchParams.get("code_challenge");
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(location).not.toContain(verifier);
    expect(state).not.toContain(verifier);
  });
});

describe("OAuth callbacks", () => {
  async function linkedinRoundTrip() {
    const { state, cookies } = await start(linkedinStart, "/api/oauth/linkedin/start");
    return { state, cookie: `ac_oauth_linkedin=${cookies.get("ac_oauth_linkedin")?.value}` };
  }

  it("connect when cookie, state and session merchant all match — then clear the cookie", async () => {
    const { state, cookie } = await linkedinRoundTrip();
    const res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c1", state }, cookie);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=linkedin&status=success");
    expect(providers.exchangeLinkedInCode).toHaveBeenCalledWith("c1");
    const upsert = service.calls.find((c) => c.table === "social_channels" && c.method === "upsert");
    const row = upsert?.args[0] as Record<string, unknown>;
    expect(row.merchant_id).toBe(MERCHANT_A.id);
    expect(row.external_id).toBe("urn:li:organization:42");
    expect(String(row.access_token_encrypted)).toMatch(/^enc:v1:/);
    expect(setCookies(res).get("ac_oauth_linkedin")?.raw).toMatch(/Max-Age=0/);
  });

  it("reject a callback whose state nonce does not match this browser's cookie (state_mismatch)", async () => {
    const attacker = await linkedinRoundTrip(); // attacker's own authorize link
    const victim = await linkedinRoundTrip(); // victim started an unrelated flow
    const res = await callback(
      linkedinCallback,
      "/api/oauth/linkedin/callback",
      { code: "attacker-code", state: attacker.state },
      victim.cookie
    );
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=linkedin&status=error&error=state_mismatch");
    expect(providers.exchangeLinkedInCode).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it("reject a callback without the flow cookie (state_mismatch)", async () => {
    const { state } = await linkedinRoundTrip();
    const res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state });
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(providers.exchangeLinkedInCode).not.toHaveBeenCalled();
  });

  it("reject a callback when the signed-in merchant is not the state's merchant (merchant_mismatch)", async () => {
    const { state, cookie } = await linkedinRoundTrip(); // started as merchant A
    signIn(MERCHANT_B);
    const res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state }, cookie);
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=linkedin&status=error&error=merchant_mismatch");
    expect(providers.exchangeLinkedInCode).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it("reject a callback without a session (not_signed_in)", async () => {
    const { state, cookie } = await linkedinRoundTrip();
    signIn(null);
    const res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state }, cookie);
    expect(res.headers.get("location")).toContain("error=not_signed_in");
    expect(providers.exchangeLinkedInCode).not.toHaveBeenCalled();
  });

  it("map provider denial, missing params and tampered state to stable codes", async () => {
    const { state, cookie } = await linkedinRoundTrip();
    const denied = await callback(
      linkedinCallback,
      "/api/oauth/linkedin/callback",
      { error: "user_cancelled_login", error_description: "The <b>user</b> cancelled", state },
      cookie
    );
    expect(denied.headers.get("location")).toBe("/integrations/callback?platform=linkedin&status=error&error=provider_denied");
    expect(setCookies(denied).get("ac_oauth_linkedin")?.raw).toMatch(/Max-Age=0/);

    const missing = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { state }, cookie);
    expect(missing.headers.get("location")).toContain("error=missing_code_or_state");

    const tampered = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state: `${state}x` }, cookie);
    expect(tampered.headers.get("location")).toContain("error=bad_state");
    expect(providers.exchangeLinkedInCode).not.toHaveBeenCalled();
  });

  it("never put exception or database text in the redirect", async () => {
    const leaky = "duplicate key value violates unique constraint \"secret_idx\" token=abc";
    providers.exchangeLinkedInCode.mockRejectedValueOnce(new Error(leaky));
    let flow = await linkedinRoundTrip();
    let res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=linkedin&status=error&error=token_exchange_failed");
    expect(reportError).toHaveBeenCalled(); // detail goes to the server log, not the URL

    providers.resolveLinkedInActorUrn.mockRejectedValueOnce(new Error("No LinkedIn organization admin access found"));
    flow = await linkedinRoundTrip();
    res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toContain("error=account_lookup_failed");

    db.results.social_channels = { error: { code: "23505", message: leaky } };
    flow = await linkedinRoundTrip();
    res = await callback(linkedinCallback, "/api/oauth/linkedin/callback", { code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toContain("error=save_failed");
    expect(res.headers.get("location")).not.toContain("duplicate");
  });

  it("refuse a state minted for another platform", async () => {
    const x = await start(xStart, "/api/oauth/x/start");
    const res = await callback(
      linkedinCallback,
      "/api/oauth/linkedin/callback",
      { code: "c", state: x.state },
      `ac_oauth_linkedin=${x.cookies.get("ac_oauth_x")?.value.split(".")[0]}`
    );
    expect(res.headers.get("location")).toContain("error=bad_state");
  });

  it("pass the PKCE verifier from the cookie to the X token exchange", async () => {
    providers.exchangeXCode.mockResolvedValue({ access_token: "x-access", expires_in: 7200 });
    providers.resolveXUserId.mockResolvedValue("x-user-1");
    const { state, cookies } = await start(xStart, "/api/oauth/x/start");
    const cookieValue = cookies.get("ac_oauth_x")?.value ?? "";
    const res = await callback(xCallback, "/api/oauth/x/callback", { code: "xc", state }, `ac_oauth_x=${cookieValue}`);
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=x&status=success");
    expect(providers.exchangeXCode).toHaveBeenCalledWith("xc", cookieValue.split(".")[1]);
  });

  it("reject an X callback whose cookie lost the verifier", async () => {
    const { state, cookies } = await start(xStart, "/api/oauth/x/start");
    const nonceOnly = cookies.get("ac_oauth_x")?.value.split(".")[0];
    const res = await callback(xCallback, "/api/oauth/x/callback", { code: "xc", state }, `ac_oauth_x=${nonceOnly}`);
    expect(res.headers.get("location")).toContain("error=state_mismatch");
    expect(providers.exchangeXCode).not.toHaveBeenCalled();
  });

  it("brand Meta failures without a readable state as `meta`, and Meta successes by target", async () => {
    const denied = await callback(metaCallback, "/api/oauth/meta/callback", { error: "access_denied" });
    expect(denied.headers.get("location")).toBe("/integrations/callback?platform=meta&status=error&error=provider_denied");

    providers.exchangeMetaCode.mockResolvedValue({ accessToken: "meta-access", expiresIn: 5000 });
    providers.resolveWhatsAppPhoneId.mockResolvedValue("phone-1");
    const { state, cookies } = await start(metaStart, "/api/oauth/meta/start?target=whatsapp");
    const res = await callback(
      metaCallback,
      "/api/oauth/meta/callback",
      { code: "mc", state },
      `ac_oauth_meta=${cookies.get("ac_oauth_meta")?.value}`
    );
    expect(res.headers.get("location")).toBe("/integrations/callback?platform=whatsapp&status=success");
    const row = service.calls.find((c) => c.method === "upsert")?.args[0] as Record<string, unknown>;
    expect(row).toMatchObject({ merchant_id: MERCHANT_A.id, platform: "whatsapp", external_id: "phone-1" });
  });
});
