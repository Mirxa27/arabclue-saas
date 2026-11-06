/**
 * The one-click flow end to end (start → callback) for the DPA gate and the SW-7 channel
 * mapping: Gmail stores the sending address; WhatsApp resolves its number and points the
 * WABA's webhooks at this employee, or asks the merchant to choose (setup_required).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setCookies } from "../helpers/fake-gotrue";
import { fakeSupabase } from "../helpers/fake-supabase";
import { decryptIntegrationCredentials } from "@/lib/employees/credentials";

const MERCHANT = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a", dpa_version: "2026-11" as string | null };
const EMPLOYEE = "eeeeeeee-0000-4000-8000-0000000000e2";
const SITE = "http://localhost:3111";

const auth = vi.hoisted(() => ({ merchant: null as null | { id: string; owner_user_id: string; dpa_version: string | null } }));
const fetchMock = vi.hoisted(() => vi.fn());
let userDb = fakeSupabase({});
let serviceDb = fakeSupabase({});

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: auth.merchant ? { id: auth.merchant.owner_user_id } : null, merchant: auth.merchant })),
  getCurrentMerchant: vi.fn(async () => auth.merchant)
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServerSupabase: async () => userDb.client,
  getServiceSupabase: () => serviceDb.client
}));

import { GET as startGet } from "@/app/api/employees/[id]/oauth/[kind]/start/route";
import { GET as callbackGet } from "@/app/api/employees/oauth/callback/route";

let ip = 0;
async function start(kind: string) {
  ip += 1;
  const req = new NextRequest(`${SITE}/api/employees/${EMPLOYEE}/oauth/${kind}/start?return_to=${encodeURIComponent(`/employees/${EMPLOYEE}?tab=integrations`)}`, {
    headers: { "x-forwarded-for": `198.51.100.${ip}` }
  });
  const res = await startGet(req, { params: Promise.resolve({ id: EMPLOYEE, kind }) });
  const location = res.headers.get("location") ?? "";
  const state = location.startsWith("http") ? new URL(location).searchParams.get("state") ?? "" : "";
  return { location, state, cookie: setCookies(res).get("ac_oauth_employee") };
}
const callback = (query: Record<string, string>, cookie?: string) =>
  callbackGet(new NextRequest(`${SITE}/api/employees/oauth/callback?${new URLSearchParams(query)}`, { headers: cookie ? { cookie } : {} }));
const upserted = () =>
  serviceDb.calls.find((c) => c.table === "ai_employee_integrations" && c.method === "upsert")?.args[0] as {
    credentials: Record<string, unknown>;
    status: string;
    external_id: string | null;
    config: Record<string, unknown>;
  };

beforeEach(() => {
  vi.stubEnv("OAUTH_STATE_SECRET", "test-oauth-state-secret-at-least-32-chars");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  vi.stubEnv("GOOGLE_CLIENT_ID", "g-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "g-secret");
  vi.stubEnv("META_APP_ID", "900000000000001");
  vi.stubEnv("META_APP_SECRET", "platform-meta-secret");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-0123456789abcdef");
  auth.merchant = { ...MERCHANT };
  userDb = fakeSupabase({ ai_employees: { data: { id: EMPLOYEE }, error: null } });
  serviceDb = fakeSupabase({ ai_employee_integrations: { error: null }, ai_employee_actions: { error: null } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("DPA gate on the one-click start", () => {
  it("a customer-facing channel cannot start without the current DPA; internal tools can", async () => {
    auth.merchant = { ...MERCHANT, dpa_version: "2025-01" };
    expect((await start("gmail")).location).toBe(`/employees/${EMPLOYEE}?tab=integrations&oauth=error&oauth_kind=gmail&oauth_note=dpa_required`);
    expect((await start("whatsapp")).location).toContain("oauth_note=dpa_required");
    expect((await start("google_drive")).location.startsWith("https://accounts.google.com/")).toBe(true);
  });
});

describe("SW-7 mapping in the callback", () => {
  it("Gmail stores the account address the Gmail API sends as", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("https://oauth2.googleapis.com/token")
        ? new Response(JSON.stringify({ access_token: "g-access", refresh_token: "g-refresh", expires_in: 3600 }))
        : new Response(JSON.stringify({ sub: "g-user", email: "ops@store.sa" }))
    );
    const { state, cookie } = await start("gmail");
    const res = await callback({ code: "gc", state }, `ac_oauth_employee=${cookie?.value}`);
    expect(res.headers.get("location")).toContain("oauth=connected&oauth_kind=gmail");
    expect(decryptIntegrationCredentials(upserted().credentials)).toMatchObject({ access_token: "g-access", refresh_token: "g-refresh", email: "ops@store.sa" });
    expect(upserted().external_id).toBe("ops@store.sa");
  });

  function metaRoutes(numbers: string[]) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/oauth/access_token") && u.includes("fb_exchange_token")) return new Response(JSON.stringify({ access_token: "EAALONG", expires_in: 5183944 }));
      if (u.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "EAASHORT", token_type: "bearer" }));
      if (u.includes("/debug_token")) {
        return new Response(
          JSON.stringify({ data: { app_id: "900000000000001", is_valid: true, granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["555000111"] }] } })
        );
      }
      if (u.includes("/555000111/phone_numbers")) return new Response(JSON.stringify({ data: numbers.map((id) => ({ id, display_phone_number: id })) }));
      if (u.includes("/555000111/subscribed_apps") && init?.method === "POST") return new Response(JSON.stringify({ success: true }));
      throw new Error(`unexpected fetch ${u}`);
    });
  }

  it("WhatsApp with one number: connected with phone_number_id; the WABA's webhooks are overridden to this employee", async () => {
    metaRoutes(["106600000000001"]);
    const { state, cookie } = await start("whatsapp");
    const res = await callback({ code: "mc", state }, `ac_oauth_employee=${cookie?.value}`);
    expect(res.headers.get("location")).toBe(`/employees/${EMPLOYEE}?tab=integrations&oauth=connected&oauth_kind=whatsapp`);
    expect(upserted()).toMatchObject({ status: "connected", external_id: "106600000000001", config: { connected_via: "oauth" } });
    expect(decryptIntegrationCredentials(upserted().credentials)).toMatchObject({ phone_number_id: "106600000000001", access_token: "EAALONG", waba_id: "555000111" });
    const sub = fetchMock.mock.calls.find(([u]) => String(u).includes("/subscribed_apps"));
    expect(String(sub?.[1]?.body)).toContain(encodeURIComponent(`${SITE}/api/employees/webhooks/whatsapp/${EMPLOYEE}`));
    expect(serviceDb.calls.some((c) => c.table === "ai_employee_integrations" && c.method === "update")).toBe(true);
  });

  it("WhatsApp with several numbers: saved disconnected with the options; redirect says setup_required", async () => {
    metaRoutes(["106600000000001", "106600000000002"]);
    const { state, cookie } = await start("whatsapp");
    const res = await callback({ code: "mc", state }, `ac_oauth_employee=${cookie?.value}`);
    expect(res.headers.get("location")).toBe(
      `/employees/${EMPLOYEE}?tab=integrations&oauth=setup_required&oauth_kind=whatsapp&oauth_setup=choose_phone_number`
    );
    const row = upserted() as unknown as { status: string; config: { setup: { options: unknown[] } } };
    expect(row.status).toBe("disconnected");
    expect(row.config.setup.options).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/subscribed_apps"))).toBe(false);
  });

  it("a WhatsApp token of another app is refused (account_lookup_failed) and nothing is saved", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "EAAX" }));
      if (u.includes("/debug_token")) return new Response(JSON.stringify({ data: { app_id: "1", is_valid: true } }));
      throw new Error(`unexpected fetch ${u}`);
    });
    const { state, cookie } = await start("whatsapp");
    const res = await callback({ code: "mc", state }, `ac_oauth_employee=${cookie?.value}`);
    expect(res.headers.get("location")).toContain("oauth=error&oauth_kind=whatsapp&oauth_note=account_lookup_failed");
    expect(upserted()).toBeUndefined();
  });
});
