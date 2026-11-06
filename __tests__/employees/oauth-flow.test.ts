/**
 * F16 for employee integrations (Gmail, Slack, HubSpot, X, …): the start route binds the flow
 * to this browser (cookie nonce + PKCE verifier, never in the URL state); the callback requires
 * cookie == state.nonce, session merchant == state.merchantId and employee ownership.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { setCookies } from "../helpers/fake-gotrue";
import { fakeSupabase, type QueryResult } from "../helpers/fake-supabase";
import { createEmployeeOAuthState, verifyEmployeeOAuthState } from "@/lib/employees/oauth/state";

const MERCHANT_A = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a" };
const MERCHANT_B = { id: "bbbbbbbb-0000-4000-8000-00000000000b", owner_user_id: "user-b" };
const EMPLOYEE = "eeeeeeee-0000-4000-8000-0000000000e1";

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  merchant: null as null | { id: string; owner_user_id: string }
}));
const db = vi.hoisted(() => ({ user: {} as Record<string, QueryResult>, service: {} as Record<string, QueryResult> }));
const fetchMock = vi.hoisted(() => vi.fn());
let userDb = fakeSupabase({});
let serviceDb = fakeSupabase({});

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: auth.user, merchant: auth.merchant })),
  getCurrentMerchant: vi.fn(async () => auth.merchant)
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServerSupabase: async () => userDb.client,
  getServiceSupabase: () => serviceDb.client
}));

import { GET as startGet } from "@/app/api/employees/[id]/oauth/[kind]/start/route";
import { GET as callbackGet } from "@/app/api/employees/oauth/callback/route";

const SITE = "http://localhost:3111";
let ip = 0;

function signIn(m: typeof MERCHANT_A | null) {
  auth.user = m ? { id: m.owner_user_id } : null;
  auth.merchant = m;
}

async function start(kind: string, query = `return_to=${encodeURIComponent(`/employees/${EMPLOYEE}?tab=integrations`)}`) {
  ip += 1;
  const req = new NextRequest(`${SITE}/api/employees/${EMPLOYEE}/oauth/${kind}/start?${query}`, {
    headers: { "x-forwarded-for": `198.51.100.${ip}` }
  });
  const res = await startGet(req, { params: Promise.resolve({ id: EMPLOYEE, kind }) });
  const location = res.headers.get("location") ?? "";
  const state = location.startsWith("http") ? new URL(location).searchParams.get("state") ?? "" : "";
  return { res, location, state, cookie: setCookies(res).get("ac_oauth_employee") };
}

const callback = (query: Record<string, string>, cookie?: string) =>
  callbackGet(
    new NextRequest(`${SITE}/api/employees/oauth/callback?${new URLSearchParams(query)}`, {
      headers: cookie ? { cookie } : {}
    })
  );

function stateBody(state: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("GOOGLE_CLIENT_ID", "g-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "g-secret");
  vi.stubEnv("X_CLIENT_ID", "x-id");
  vi.stubEnv("X_CLIENT_SECRET", "x-secret");
  signIn(MERCHANT_A);
  db.user = { ai_employees: { data: { id: EMPLOYEE }, error: null } };
  db.service = { ai_employee_integrations: { error: null }, ai_employee_actions: { error: null } };
  userDb = fakeSupabase(db.user);
  serviceDb = fakeSupabase(db.service);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("employee OAuth state", () => {
  it("never carries a PKCE verifier and requires a nonce", () => {
    vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
    const state = createEmployeeOAuthState({
      employeeId: EMPLOYEE,
      merchantId: MERCHANT_A.id,
      kind: "x",
      nonce: "n".repeat(24),
      // Even if a caller tries to smuggle one in, it is not serialised.
      ...({ codeVerifier: "secret-verifier" } as object)
    });
    expect(Object.keys(stateBody(state)).sort()).toEqual(["employeeId", "exp", "kind", "merchantId", "nonce"]);
    expect(verifyEmployeeOAuthState(state).nonce).toBe("n".repeat(24));
  });
});

describe("GET /api/employees/:id/oauth/:kind/start", () => {
  it("sends signed-out visitors to /login?next=<start URL incl. return_to>", async () => {
    signIn(null);
    const { res, location } = await start("gmail");
    expect(res.status).toBe(303);
    const next = new URLSearchParams(location.split("?")[1]).get("next");
    expect(next).toBe(`/api/employees/${EMPLOYEE}/oauth/gmail/start?return_to=${encodeURIComponent(`/employees/${EMPLOYEE}?tab=integrations`)}`);
  });

  it("keeps the PKCE verifier in the httpOnly cookie, not in the state (X)", async () => {
    const { location, state, cookie } = await start("x");
    const [nonce, verifier] = (cookie?.value ?? "").split(".");
    expect(cookie?.raw).toMatch(/HttpOnly/i);
    expect(stateBody(state)).not.toHaveProperty("codeVerifier");
    expect(stateBody(state).nonce).toBe(nonce);
    expect(new URL(location).searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url")
    );
  });

  it("refuses employees of other merchants and unsafe return_to values", async () => {
    db.user.ai_employees = { data: null, error: null };
    const notMine = await start("gmail");
    expect(notMine.location).toBe("/employees?oauth=error&oauth_kind=gmail&oauth_note=employee_not_found");

    db.user.ai_employees = { data: { id: EMPLOYEE }, error: null };
    const { state } = await start("gmail", `return_to=${encodeURIComponent("//evil.example/steal")}`);
    expect(stateBody(state).returnTo).toBe(`/employees/${EMPLOYEE}?tab=integrations`);
  });

  it("reports unknown and unconfigured providers with stable codes (no echo of the URL segment)", async () => {
    const unknown = await start("<script>");
    expect(unknown.location).toBe(`/employees/${EMPLOYEE}?tab=integrations&oauth=error&oauth_note=unknown_provider`);
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect((await start("gmail")).location).toContain("oauth_note=not_configured");
  });
});

describe("GET /api/employees/oauth/callback", () => {
  async function gmailFlow() {
    const { state, cookie } = await start("gmail");
    return { state, cookie: `ac_oauth_employee=${cookie?.value}` };
  }

  it("connects when cookie, state, session merchant and employee ownership all match", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "g-access", refresh_token: "g-refresh", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: "g-user", email: "ops@store.sa" }), { status: 200 });
    });
    const { state, cookie } = await gmailFlow();
    const res = await callback({ code: "gc", state }, cookie);

    expect(res.headers.get("location")).toBe(
      `/employees/${EMPLOYEE}?tab=integrations&oauth=connected&oauth_kind=gmail`
    );
    const upsert = serviceDb.calls.find((c) => c.table === "ai_employee_integrations" && c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ employee_id: EMPLOYEE, kind: "gmail", status: "connected" });
    // Ownership was checked with the employee id AND the session merchant.
    const eqs = userDb.calls.filter((c) => c.table === "ai_employees" && c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([["id", EMPLOYEE], ["merchant_id", MERCHANT_A.id], ["id", EMPLOYEE], ["merchant_id", MERCHANT_A.id]]);
    expect(setCookies(res).get("ac_oauth_employee")?.raw).toMatch(/Max-Age=0/);
  });

  it("rejects nonce mismatch, merchant mismatch and foreign employees before any token exchange", async () => {
    const attacker = await gmailFlow();
    const victim = await gmailFlow();
    let res = await callback({ code: "c", state: attacker.state }, victim.cookie);
    expect(res.headers.get("location")).toContain("oauth=error&oauth_kind=gmail&oauth_note=state_mismatch");

    const flow = await gmailFlow();
    signIn(MERCHANT_B);
    res = await callback({ code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toContain("oauth_note=merchant_mismatch");

    signIn(MERCHANT_A);
    const again = await gmailFlow();
    db.user.ai_employees = { data: null, error: null }; // employee deleted / not this merchant's
    res = await callback({ code: "c", state: again.state }, again.cookie);
    expect(res.headers.get("location")).toContain("oauth_note=employee_not_found");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(serviceDb.calls).toHaveLength(0);
  });

  it("uses the cookie's PKCE verifier for X and fails closed without it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "x-access" }), { status: 200 }));
    const { state, cookie } = await start("x");
    const value = cookie?.value ?? "";
    const ok = await callback({ code: "xc", state }, `ac_oauth_employee=${value}`);
    expect(ok.headers.get("location")).toContain("oauth=connected&oauth_kind=x");
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("code_verifier")).toBe(value.split(".")[1]);

    fetchMock.mockClear();
    const second = await start("x");
    const nonceOnly = (second.cookie?.value ?? "").split(".")[0];
    const res = await callback({ code: "xc", state: second.state }, `ac_oauth_employee=${nonceOnly}`);
    expect(res.headers.get("location")).toContain("oauth_note=state_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects with stable codes only — never provider or database text", async () => {
    const denied = await callback({ error: "access_denied", error_description: "Your account is locked, call +966500" });
    expect(denied.headers.get("location")).toBe("/employees?oauth=error&oauth_note=provider_denied");

    const bad = await callback({ code: "c", state: "forged.sig" });
    expect(bad.headers.get("location")).toBe("/employees?oauth=error&oauth_note=bad_state");

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error_description: "invalid_grant: secret=abc" }), { status: 400 }));
    let flow = await gmailFlow();
    let res = await callback({ code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toContain("oauth_note=token_exchange_failed");
    expect(res.headers.get("location")).not.toContain("invalid_grant");

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: "ok" }), { status: 200 }));
    db.service.ai_employee_integrations = { error: { code: "23502", message: "null value in column \"x\" violates not-null" } };
    flow = await gmailFlow();
    res = await callback({ code: "c", state: flow.state }, flow.cookie);
    expect(res.headers.get("location")).toContain("oauth_note=save_failed");
    expect(res.headers.get("location")).not.toContain("null value");
  });

  it("still lands on a safe page when the state's returnTo is unusable", async () => {
    const nonce = "n".repeat(24);
    const state = createEmployeeOAuthState({
      employeeId: EMPLOYEE,
      merchantId: MERCHANT_A.id,
      kind: "gmail",
      returnTo: "//evil.example",
      nonce
    });
    const res = await callback({ code: "c", state }, `ac_oauth_employee=${"m".repeat(24)}`);
    expect(res.headers.get("location")).toBe("/employees?oauth=error&oauth_kind=gmail&oauth_note=state_mismatch");
  });
});
