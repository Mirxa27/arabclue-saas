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
  return { ...actual, requireMerchantApi: vi.fn(async () => ({ id: "merchant-1" })) };
});
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => {
    throw new Error("connect writes go through the merchant's RLS-scoped session");
  }
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
function stubGraph(me: GraphRoute, subscribe: GraphRoute = { status: 200, body: { success: true } }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/me?")) return new Response(JSON.stringify(me.body), { status: me.status });
    if (url.includes("/subscribed_apps")) return new Response(JSON.stringify(subscribe.body), { status: subscribe.status });
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
  for (const k of ["TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SITE_URL", "META_APP_SECRET"]) delete process.env[k];
});

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

  it("requires app_secret unless the operator set META_APP_SECRET", async () => {
    stubGraph({ status: 200, body: { id: PAGE } });
    const res = await connect({ kind: "meta", credentials: { ...metaCreds, app_secret: undefined } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/app_secret/);
    process.env.META_APP_SECRET = "operator-secret-0123456789";
    expect((await connect({ kind: "meta", credentials: { ...metaCreds, app_secret: "" } })).status).toBe(200);
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
  it("stores free-form credentials and the client's external_id", async () => {
    const res = await connect({ kind: "email", external_id: "ops@store.sa", credentials: { smtp_host: "smtp.x", smtp_pass: "p" } });
    expect(res.status).toBe(200);
    expect((upsert()?.payload as { external_id: string }).external_id).toBe("ops@store.sa");
    expect(storedCreds()).toEqual({ smtp_host: "smtp.x", smtp_pass: "p" });
  });

  it("bounds the credentials record (keys counted before parsing)", async () => {
    const credentials = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"]));
    expect((await connect({ kind: "email", credentials })).status).toBe(400);
  });
});
