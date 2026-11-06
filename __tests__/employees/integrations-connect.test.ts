/**
 * POST /api/employees/:id/integrations — manual channel connects.
 *  - meta / instagram: per-kind validation, prepareMetaIntegration ownership proof + Page
 *    subscription, verified external_id, server-owned config, encrypted secrets.
 *  - whatsapp: app_secret accepted (F03).
 *  - telegram (F29): 256-bit server secret, NEXT_PUBLIC_SITE_URL base, 503 when unset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptIntegrationCredentials } from "@/lib/employees/credentials";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  existing: null as Record<string, unknown> | null
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  // dpa_version "2026-11" (CURRENT_DPA_VERSION): customer-facing channels need the current DPA.
  return { ...actual, requireMerchantApi: vi.fn(async () => ({ id: "merchant-1", dpa_version: "2026-11" })) };
});
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => {
    throw new Error("connect writes go through the merchant's RLS-scoped session");
  }
}));
// The route's per-merchant connect limit is not what these tests exercise.
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => ({ success: true, limit: 20, remaining: 19, resetAt: 0 }))
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { POST } from "@/app/api/employees/[id]/integrations/route";

const EMP = "77777777-7777-4777-8777-777777777777";
const SITE = "https://app.arabclue.test";
const ctx = { params: Promise.resolve({ id: EMP }) };
const PAGE = "104000000000001";
const IG = "17841400000000001";
const PAGE_TOKEN = "EAAPAGEtoken_0123456789abcdefghij";
const metaCreds = {
  page_id: PAGE,
  page_access_token: PAGE_TOKEN,
  app_secret: "0123456789abcdef0123456789abcdef",
  verify_token: "my-own-verify-token-123"
};

function useUserDb() {
  h.user = createFakeSupabase("user", (call: FakeCall) => {
    if (call.table === "ai_employees") return { data: { id: EMP } };
    if (call.table === "ai_employee_integrations" && call.op === "select") {
      return { data: h.existing ? { credentials: h.existing } : null };
    }
    if (call.table === "ai_employee_integrations" && call.op === "upsert") {
      const p = call.payload as Record<string, unknown>;
      return { data: { id: "int-1", employee_id: EMP, kind: p.kind, external_id: p.external_id, config: p.config, status: p.status } };
    }
    return undefined;
  });
}

const upsert = () => h.user.calls.find((c) => c.table === "ai_employee_integrations" && c.op === "upsert");
const storedCreds = () => decryptIntegrationCredentials((upsert()?.payload as { credentials: Record<string, unknown> }).credentials);
const connect = (body: unknown) => POST(jsonRequest(`https://arabclue.test/api/employees/${EMP}/integrations`, body), ctx);

type GraphRoute = { status: number; body: unknown };
function stubGraph(
  me: GraphRoute,
  subscribe: GraphRoute = { status: 200, body: { success: true } },
  debugToken?: GraphRoute
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/me?")) return new Response(JSON.stringify(me.body), { status: me.status });
    if (url.includes("/subscribed_apps")) return new Response(JSON.stringify(subscribe.body), { status: subscribe.status });
    if (url.includes("/debug_token?") && debugToken) {
      return new Response(JSON.stringify(debugToken.body), { status: debugToken.status });
    }
    if (url.includes("api.telegram.org")) return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.existing = null;
  useUserDb();
  process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SITE_URL", "META_APP_SECRET", "META_APP_ID"]) delete process.env[k];
});

// The platform Meta app (META_APP_ID / META_APP_SECRET) — always configured in production.
const PLATFORM_APP_ID = "900000000000001";
const PLATFORM_SECRET = "operator-secret-0123456789";
function usePlatformApp() {
  process.env.META_APP_ID = PLATFORM_APP_ID;
  process.env.META_APP_SECRET = PLATFORM_SECRET;
}
const tokenIssuedTo = (appId: string): GraphRoute => ({
  status: 200,
  body: { data: { app_id: appId, type: "PAGE", application: "App", is_valid: true, profile_id: PAGE } }
});
const OTHER_APP_TOKEN: GraphRoute = {
  status: 400,
  body: { error: { message: "(#100) The App_id in the input_token did not match the Viewing App", code: 100 } }
};
const subscribedCalls = (fetchMock: ReturnType<typeof stubGraph>) =>
  fetchMock.mock.calls.filter(([u]) => String(u).includes("/subscribed_apps")).length;

describe("meta (Messenger) connect", () => {
  it("verifies the token owns the Page, subscribes it, stores the verified id and encrypted secrets", async () => {
    const fetchMock = stubGraph({ status: 200, body: { id: PAGE, name: "متجر الورد" } });
    const res = await connect({ kind: "meta", external_id: "999-client-value", credentials: metaCreds, config: { connected_via: "oauth", note: "x" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhook_url).toBe(`${SITE}/api/employees/webhooks/meta/${EMP}`);
    expect(json.integration).not.toHaveProperty("credentials");

    const payload = upsert()?.payload as Record<string, unknown>;
    expect(payload.external_id).toBe(PAGE); // never the client's value
    expect(payload.config).toEqual({
      note: "x",
      connected_via: "manual", // a client cannot claim "oauth" (that would unlock META_APP_SECRET fallbacks)
      page_name: "متجر الورد",
      subscribed: true,
      subscribed_fields: ["messages"]
    });
    expect(JSON.stringify(payload.credentials)).not.toContain(PAGE_TOKEN); // encrypted at rest
    expect(storedCreds()).toEqual(metaCreds);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/${PAGE}/subscribed_apps?subscribed_fields=messages`))).toBe(true);
  });

  it.each([
    ["a non-numeric page_id", { ...metaCreds, page_id: "my-page" }, /page_id/],
    ["a short verify_token", { ...metaCreds, verify_token: "short" }, /verify_token/],
    ["a missing page_access_token", { ...metaCreds, page_access_token: undefined }, /page_access_token/]
  ])("400 for %s, without calling Meta", async (_l, credentials, message) => {
    const fetchMock = stubGraph({ status: 200, body: { id: PAGE } });
    const res = await connect({ kind: "meta", credentials });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert()).toBeUndefined();
  });

  it("requires app_secret when no platform Meta app is configured, without calling Meta", async () => {
    const fetchMock = stubGraph({ status: 200, body: { id: PAGE } });
    const res = await connect({ kind: "meta", credentials: { ...metaCreds, app_secret: undefined } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/app_secret/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert()).toBeUndefined();
  });

  it.each([
    ["omitted", undefined],
    ["blank", ""]
  ])("RB-W1: app_secret %s with META_APP_SECRET set (production) and a token of the merchant's own app → 400, nothing saved or subscribed", async (_l, appSecret) => {
    usePlatformApp();
    const fetchMock = stubGraph({ status: 200, body: { id: PAGE } }, undefined, OTHER_APP_TOKEN);
    const res = await connect({ kind: "meta", credentials: { ...metaCreds, app_secret: appSecret } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/app_secret: required/);
    expect(upsert()).toBeUndefined();
    expect(subscribedCalls(fetchMock)).toBe(0);
  });

  it("RB-W1: a Page token issued to the platform app connects without app_secret as connected_via 'platform'", async () => {
    usePlatformApp();
    stubGraph({ status: 200, body: { id: PAGE, name: "Store" } }, undefined, tokenIssuedTo(PLATFORM_APP_ID));
    const res = await connect({
      kind: "meta",
      credentials: { ...metaCreds, app_secret: undefined },
      config: { connected_via: "manual" } // client value ignored either way
    });
    expect(res.status).toBe(200);
    expect((upsert()?.payload as { config: Record<string, unknown> }).config).toMatchObject({ connected_via: "platform" });
    const { app_secret: _omitted, ...withoutSecret } = metaCreds;
    expect(storedCreds()).toEqual(withoutSecret);
  });

  it("a client cannot claim connected_via 'platform' (that would unlock META_APP_SECRET)", async () => {
    usePlatformApp();
    stubGraph({ status: 200, body: { id: PAGE } });
    const res = await connect({ kind: "meta", credentials: metaCreds, config: { connected_via: "platform" } });
    expect(res.status).toBe(200);
    expect((upsert()?.payload as { config: Record<string, unknown> }).config).toMatchObject({ connected_via: "manual" });
  });

  it("502 (retry) when Meta cannot be asked which app issued the token", async () => {
    usePlatformApp();
    stubGraph({ status: 200, body: { id: PAGE } }, undefined, { status: 500, body: { error: { message: "Service unavailable", code: 2 } } });
    const res = await connect({ kind: "meta", credentials: { ...metaCreds, app_secret: undefined } });
    expect(res.status).toBe(502);
    expect(upsert()).toBeUndefined();
  });

  it("400 with Meta's reason when the token belongs to another Page", async () => {
    stubGraph({ status: 200, body: { id: "555" } });
    const res = await connect({ kind: "meta", credentials: metaCreds });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/belongs to 555, not Page/);
    expect(upsert()).toBeUndefined();
  });
});

describe("instagram (Direct) connect", () => {
  it("resolves the IG account from the Page, uses it as external_id, and keeps an OAuth row's tokens", async () => {
    h.existing = { access_token: "oauth-publishing-token", scope: "instagram_basic" };
    stubGraph({ status: 200, body: { id: PAGE, instagram_business_account: { id: IG } } });
    const res = await connect({ kind: "instagram", credentials: metaCreds });
    expect(res.status).toBe(200);
    expect((upsert()?.payload as { external_id: string }).external_id).toBe(IG);
    expect(storedCreds()).toEqual({ access_token: "oauth-publishing-token", scope: "instagram_basic", ...metaCreds, ig_account_id: IG });
  });

  it("RB-W1: reconnecting through the platform app drops the app_secret an earlier manual connect stored", async () => {
    usePlatformApp();
    h.existing = {
      access_token: "oauth-publishing-token",
      scope: "instagram_basic",
      page_id: PAGE,
      page_access_token: "EAAold-page-token-0123456789",
      ig_account_id: IG,
      app_secret: "stale-own-app-secret-0123456789",
      verify_token: "old-verify-token-123456"
    };
    stubGraph({ status: 200, body: { id: PAGE, instagram_business_account: { id: IG } } }, undefined, tokenIssuedTo(PLATFORM_APP_ID));
    const res = await connect({ kind: "instagram", credentials: { ...metaCreds, app_secret: undefined } });
    expect(res.status).toBe(200);
    // A stale own secret would outrank META_APP_SECRET and every platform-signed delivery would be refused.
    expect(storedCreds()).toEqual({
      access_token: "oauth-publishing-token",
      scope: "instagram_basic",
      page_id: PAGE,
      page_access_token: PAGE_TOKEN,
      verify_token: metaCreds.verify_token,
      ig_account_id: IG
    });
    expect((upsert()?.payload as { config: Record<string, unknown> }).config).toMatchObject({ connected_via: "platform" });
  });

  it("400 when the Page has no linked Instagram professional account", async () => {
    stubGraph({ status: 200, body: { id: PAGE } });
    expect((await connect({ kind: "instagram", credentials: metaCreds })).status).toBe(400);
  });
});

describe("whatsapp connect (F03)", () => {
  it("accepts and encrypts app_secret", async () => {
    const credentials = { phone_number_id: "109876543210", access_token: "EAAwhatsapp_token_0123456789", verify_token: "wa-verify", app_secret: "fedcba9876543210fedcba9876543210" };
    const res = await connect({ kind: "whatsapp", credentials });
    expect(res.status).toBe(200);
    expect(storedCreds()).toEqual(credentials);
  });

  it("400 for a malformed phone_number_id or a short app_secret", async () => {
    expect((await connect({ kind: "whatsapp", credentials: { phone_number_id: "+9665", access_token: "EAAwhatsapp_token_0123456789" } })).status).toBe(400);
    expect(
      (await connect({ kind: "whatsapp", credentials: { phone_number_id: "1098", access_token: "EAAwhatsapp_token_0123456789", app_secret: "short" } })).status
    ).toBe(400);
  });
});

describe("telegram connect (F29)", () => {
  it("registers the webhook at NEXT_PUBLIC_SITE_URL with a random 256-bit secret (client value ignored)", async () => {
    const fetchMock = stubGraph({ status: 500, body: {} });
    const res = await connect({ kind: "telegram", credentials: { bot_token: "123456:ABCdef", webhook_secret: "weak" } });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telegram.org/bot123456:ABCdef/setWebhook");
    const body = JSON.parse(String(init?.body)) as { url: string; secret_token: string };
    expect(body.url).toBe(`${SITE}/api/employees/webhooks/telegram/${EMP}`);
    expect(body.secret_token).toMatch(/^[0-9a-f]{64}$/);
    expect(storedCreds()).toEqual({ bot_token: "123456:ABCdef", webhook_secret: body.secret_token });
  });

  it("503 (no hard-coded production fallback) when NEXT_PUBLIC_SITE_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const fetchMock = stubGraph({ status: 500, body: {} });
    const res = await connect({ kind: "telegram", credentials: { bot_token: "123456:ABCdef" } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert()).toBeUndefined();
  });

  it("two connects never reuse a secret", async () => {
    const fetchMock = stubGraph({ status: 500, body: {} });
    await connect({ kind: "telegram", credentials: { bot_token: "1:a" } });
    await connect({ kind: "telegram", credentials: { bot_token: "1:a" } });
    const secrets = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { secret_token: string }).secret_token);
    expect(new Set(secrets).size).toBe(2);
  });
});

describe("other kinds keep their behaviour", () => {
  it("stores free-form credentials and the client's external_id for non-messaging kinds", async () => {
    const res = await connect({ kind: "hubspot", external_id: "portal-1", credentials: { api_key: "pat-na1-xyz", portal: "1" } });
    expect(res.status).toBe(200);
    expect((upsert()?.payload as { external_id: string }).external_id).toBe("portal-1");
    expect(storedCreds()).toEqual({ api_key: "pat-na1-xyz", portal: "1" });
  });

  it("SW-6: the email channel refuses SMTP-only credentials (no platform fallback) — nothing saved", async () => {
    const res = await connect({ kind: "email", external_id: "ops@store.sa", credentials: { smtp_host: "smtp.x", smtp_pass: "p" } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("email_sender_required");
    expect(upsert()).toBeUndefined();
  });

  it("bounds the credentials record (keys counted before parsing)", async () => {
    const credentials = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"]));
    expect((await connect({ kind: "email", credentials })).status).toBe(400);
  });
});
