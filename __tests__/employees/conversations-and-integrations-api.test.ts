/**
 * APIs the workspace UI uses:
 *  - critic-17(g): list an employee's channel conversations (paginated), read one with its
 *    history, toggle escalated ↔ open;
 *  - UI-030: PATCH (update credentials / finish a one-click setup) and DELETE an integration;
 *  - DPA gate: customer-facing channels need the current DPA (409 dpa_required);
 *  - SW-4 at connect time: a webhook URL pointing inside the network is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/employees/credentials";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  merchant: { id: "m1", plan: "plus", subscription_status: "active", dpa_version: "2026-11" as string | null },
  integration: null as Record<string, unknown> | null,
  conversations: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => h.merchant)
}));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => ({ success: true, limit: 20, remaining: 19, resetAt: 0 }))
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { GET as listConvs } from "@/app/api/employees/[id]/conversations/route";
import { GET as getConv, PATCH as patchConv } from "@/app/api/employees/[id]/conversations/[conversationId]/route";
import { DELETE as disconnect, PATCH as patchIntegration, POST as connect } from "@/app/api/employees/[id]/integrations/route";

const EMP = "88888888-8888-4888-8888-888888888888";
const CONV = "99999999-9999-4999-8999-999999999999";
const ctx = { params: Promise.resolve({ id: EMP }) };
const convCtx = (conversationId = CONV) => ({ params: Promise.resolve({ id: EMP, conversationId }) });

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url.includes("api.telegram.org") && url.endsWith("/deleteWebhook")) return new Response(JSON.stringify({ ok: true, result: true }));
  if (url.includes("/subscribed_apps")) return new Response(JSON.stringify({ success: true }));
  if (url.includes("api.resend.com/domains")) return new Response(JSON.stringify({ data: [{ name: "shop.sa", status: "verified" }] }));
  throw new Error(`unexpected fetch ${url}`);
});

function useDb() {
  h.user = createFakeSupabase("user", (call: FakeCall) => {
    if (call.table === "ai_employees") return { data: { id: EMP, merchant_id: "m1", status: "active" } };
    if (call.table === "ai_employee_conversations" && call.op === "select" && call.single) {
      const id = call.filters.find(([, c]) => c === "id")?.[2];
      return { data: h.conversations.find((c) => c.id === id) ?? null };
    }
    if (call.table === "ai_employee_conversations" && call.op === "select") return { data: h.conversations };
    if (call.table === "ai_employee_conversations" && call.op === "update") {
      return { data: { ...h.conversations[0], ...(call.payload as object) } };
    }
    if (call.table === "ai_employee_messages") {
      return { data: [{ id: "m2", role: "assistant", content: "b", created_at: "2026-11-06T10:00:01+00:00" }, { id: "m1", role: "user", content: "a", created_at: "2026-11-06T10:00:00+00:00" }] };
    }
    if (call.table === "ai_employee_integrations" && call.op === "select") return { data: h.integration };
    if (call.table === "ai_employee_integrations" && (call.op === "upsert" || call.op === "update")) {
      const p = call.payload as Record<string, unknown>;
      return { data: { id: "int-1", employee_id: EMP, kind: (h.integration?.kind as string) ?? p.kind, config: p.config ?? {}, status: p.status ?? "connected" } };
    }
    return undefined;
  });
  h.service = createFakeSupabase("service");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.merchant = { id: "m1", plan: "plus", subscription_status: "active", dpa_version: "2026-11" };
  h.integration = null;
  h.conversations = [
    { id: CONV, employee_id: EMP, channel: "whatsapp", external_id: "966501112222", status: "open", last_message_at: "2026-11-06T10:00:00.123456+00:00" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", employee_id: EMP, channel: "telegram", external_id: "4242", status: "escalated", last_message_at: "2026-11-05T10:00:00+00:00" }
  ];
  useDb();
  vi.stubGlobal("fetch", fetchMock);
  process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.arabclue.test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

const userCall = (table: string, op: string) => h.user.calls.filter((c) => c.table === table && c.op === op);

describe("conversations API (critic-17g)", () => {
  it("lists channel conversations (dashboard excluded), newest first, with a cursor for the next page", async () => {
    const res = await listConvs(new (await import("next/server")).NextRequest(`http://localhost/api/employees/${EMP}/conversations?limit=1`), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toHaveLength(1);
    expect(typeof body.next_cursor).toBe("string");
    const [select] = userCall("ai_employee_conversations", "select");
    expect(select.filters).toContainEqual(["eq", "employee_id", EMP]);
    expect(select.filters).toContainEqual(["neq", "channel", "dashboard"]);

    // The cursor round-trips into a keyset filter; a forged cursor is a 400.
    const next = await listConvs(new (await import("next/server")).NextRequest(`http://localhost/api/employees/${EMP}/conversations?cursor=${body.next_cursor}`), ctx);
    expect(next.status).toBe(200);
    const keyset = userCall("ai_employee_conversations", "select")[1].filters.find(([op]) => op === "or");
    expect(String(keyset?.[1])).toContain('last_message_at.lt."2026-11-06T10:00:00.123456+00:00"');
    const forged = Buffer.from(JSON.stringify({ t: "x),id.gt.0", id: "nope" })).toString("base64url");
    expect((await listConvs(new (await import("next/server")).NextRequest(`http://localhost/api/employees/${EMP}/conversations?cursor=${forged}`), ctx)).status).toBe(400);
  });

  it("returns one conversation with its history oldest-first; another employee's is 404", async () => {
    const res = await getConv(new (await import("next/server")).NextRequest(`http://localhost/x`), convCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.id).toBe(CONV);
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["a", "b"]);
    const missing = await getConv(new (await import("next/server")).NextRequest(`http://localhost/x`), convCtx("bbbbbbbb-0000-4000-8000-00000000000b"));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("conversation_not_found");
  });

  it("toggles escalated ↔ open through the owner's session and logs it", async () => {
    const res = await patchConv(jsonRequest("http://localhost/x", { status: "escalated" }, { method: "PATCH" }), convCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).conversation.status).toBe("escalated");
    const [update] = userCall("ai_employee_conversations", "update");
    expect(update.payload).toEqual({ status: "escalated" });
    expect(update.filters).toContainEqual(["eq", "employee_id", EMP]);
    expect(h.service.calls.find((c) => c.table === "ai_employee_actions")?.payload).toMatchObject({ action: "conversation_status" });

    expect((await patchConv(jsonRequest("http://localhost/x", { status: "deleted" }, { method: "PATCH" }), convCtx())).status).toBe(400);
    h.conversations[0].channel = "dashboard";
    expect((await patchConv(jsonRequest("http://localhost/x", { status: "escalated" }, { method: "PATCH" }), convCtx())).status).toBe(400);
  });
});

describe("DPA gate for customer-facing channels", () => {
  it("409 dpa_required (with the version to accept) before anything is validated, called or saved", async () => {
    h.merchant.dpa_version = "2025-01";
    for (const kind of ["whatsapp", "telegram", "twilio_sms", "meta", "instagram", "email"]) {
      const res = await connect(jsonRequest(`http://localhost/api/employees/${EMP}/integrations`, { kind, credentials: {} }), ctx);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "dpa_required", dpa_version: "2026-11" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(userCall("ai_employee_integrations", "upsert")).toHaveLength(0);
  });

  it("internal tools (e.g. HubSpot) are not gated", async () => {
    h.merchant.dpa_version = null;
    const res = await connect(jsonRequest(`http://localhost/api/employees/${EMP}/integrations`, { kind: "hubspot", credentials: { api_key: "pat-1" } }), ctx);
    expect(res.status).toBe(200);
  });
});

describe("connect-time validation", () => {
  it("SW-4: a webhook URL inside the network is refused with webhook_url_blocked", async () => {
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://[::ffff:127.0.0.1]/", "http://localhost:8080/"]) {
      const res = await connect(jsonRequest(`http://localhost/api/employees/${EMP}/integrations`, { kind: "webhook", credentials: { url } }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("webhook_url_blocked");
    }
    expect(userCall("ai_employee_integrations", "upsert")).toHaveLength(0);
  });

  it("SW-6: email connects with the merchant's Resend key once the sender's domain is verified", async () => {
    const res = await connect(
      jsonRequest(`http://localhost/api/employees/${EMP}/integrations`, { kind: "email", credentials: { from: "Layla <layla@shop.sa>", api_key: "re_merchant_key" } }),
      ctx
    );
    expect(res.status).toBe(200);
    const [upsert] = userCall("ai_employee_integrations", "upsert");
    const p = upsert.payload as { external_id: string; credentials: Record<string, unknown>; config: Record<string, unknown> };
    expect(p.external_id).toBe("layla@shop.sa");
    expect(p.credentials).toHaveProperty("_enc");
    expect(decryptIntegrationCredentials(p.credentials)).toEqual({ from: "Layla <layla@shop.sa>", api_key: "re_merchant_key" });
    expect(p.config).toMatchObject({ sender_domain: "shop.sa", domain_verified: true });
  });

  it("refuses manual Gmail credentials (Gmail is connected with Google sign-in)", async () => {
    const res = await connect(jsonRequest(`http://localhost/api/employees/${EMP}/integrations`, { kind: "gmail", credentials: { access_token: "ya29" } }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("UI-030: update and disconnect", () => {
  it("DELETE of a missing integration is 404; Telegram's webhook is unregistered on disconnect", async () => {
    let res = await disconnect(new (await import("next/server")).NextRequest(`http://localhost/x?kind=telegram`, { method: "DELETE" }), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("integration_not_found");

    h.integration = { id: "int-tg", kind: "telegram", credentials: encryptIntegrationCredentials({ bot_token: "123:abc", webhook_secret: "s" }), config: {}, status: "connected" };
    res = await disconnect(new (await import("next/server")).NextRequest(`http://localhost/x?kind=telegram`, { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.telegram.org/bot123:abc/deleteWebhook");
    expect(userCall("ai_employee_integrations", "delete")[0].filters).toContainEqual(["eq", "employee_id", EMP]);
  });

  it("PATCH merges changed credentials (null removes a key), re-validates and keeps the row connected", async () => {
    h.integration = {
      id: "int-wa",
      kind: "whatsapp",
      external_id: null,
      credentials: encryptIntegrationCredentials({ phone_number_id: "106600000000001", access_token: "EAAold-token-0123456789", verify_token: "v1" }),
      config: { connected_via: "manual" },
      status: "connected"
    };
    const res = await patchIntegration(
      jsonRequest(`http://localhost/x`, { kind: "whatsapp", credentials: { access_token: "EAAnew-token-0123456789", verify_token: null, app_secret: "0123456789abcdef0123" } }, { method: "PATCH" }),
      ctx
    );
    expect(res.status).toBe(200);
    const [update] = userCall("ai_employee_integrations", "update");
    expect(decryptIntegrationCredentials((update.payload as { credentials: Record<string, unknown> }).credentials)).toEqual({
      phone_number_id: "106600000000001",
      access_token: "EAAnew-token-0123456789",
      app_secret: "0123456789abcdef0123"
    });
    expect(update.payload).toMatchObject({ status: "connected" });

    // Removing a key the adapter needs is refused.
    const bad = await patchIntegration(jsonRequest(`http://localhost/x`, { kind: "whatsapp", credentials: { phone_number_id: null } }, { method: "PATCH" }), ctx);
    expect(bad.status).toBe(400);
  });

  it("PATCH finishes a pending one-click WhatsApp setup with one of the listed numbers and subscribes the webhooks", async () => {
    h.integration = {
      id: "int-wa",
      kind: "whatsapp",
      external_id: null,
      credentials: encryptIntegrationCredentials({ access_token: "EAALONG", verify_token: "f".repeat(48) }),
      config: {
        connected_via: "oauth",
        setup: { state: "choose_phone_number", options: [{ id: "106600000000002", waba_id: "555000111", display_phone_number: "+966 50 000 0002", verified_name: "Shop" }] }
      },
      status: "disconnected"
    };
    const res = await patchIntegration(jsonRequest(`http://localhost/x`, { kind: "whatsapp", credentials: { phone_number_id: "106600000000002" } }, { method: "PATCH" }), ctx);
    expect(res.status).toBe(200);
    const [first] = userCall("ai_employee_integrations", "update");
    expect(first.payload).toMatchObject({ status: "connected", external_id: "106600000000002" });
    expect(decryptIntegrationCredentials((first.payload as { credentials: Record<string, unknown> }).credentials)).toMatchObject({
      phone_number_id: "106600000000002",
      waba_id: "555000111"
    });
    const sub = fetchMock.mock.calls.find(([u]) => String(u).includes("/555000111/subscribed_apps"));
    expect(String(sub?.[1]?.body)).toContain(encodeURIComponent(`https://app.arabclue.test/api/employees/webhooks/whatsapp/${EMP}`));
  });
});
