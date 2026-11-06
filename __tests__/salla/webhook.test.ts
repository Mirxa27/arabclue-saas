/**
 * F12 / critic-2 — POST /api/salla/webhook with the documented payloads (__tests__/fixtures):
 *  - app.store.authorize (Easy Mode) stores the tokens ENCRYPTED through salla_record_authorization,
 *    with the installer identity from user/info — and no token ever reaches the events log;
 *  - app.uninstalled clears the tokens; unknown events are logged without credential fields;
 *  - order.created maps the documented order onto the invoice (total = data.amounts.total) or
 *    records why it could not, instead of issuing a zero-priced invoice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { decryptSecret } from "@/lib/crypto/secrets";
import authorizeEvent from "../fixtures/salla-app-store-authorize.json";
import uninstalledEvent from "../fixtures/salla-app-uninstalled.json";
import orderCreatedEvent from "../fixtures/salla-order-created.json";
import userInfo from "../fixtures/salla-user-info.json";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError
}));

const state = vi.hoisted(() => ({
  claim: "new" as string,
  authorizeOutcome: { outcome: "pending_saved" } as Record<string, unknown>,
  merchant: null as null | Record<string, unknown>
}));
let service = createFakeSupabase("service");

vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));

import { POST } from "@/app/api/salla/webhook/route";

const SECRET = "salla-webhook-secret-for-tests";
const MERCHANT_ID = "aaaaaaaa-0000-4000-8000-00000000000a";

function signed(payload: unknown, secret = SECRET) {
  const raw = JSON.stringify(payload);
  return new NextRequest("http://localhost:3111/api/salla/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-salla-signature": createHmac("sha256", secret).update(raw).digest("hex") },
    body: raw
  });
}

function handler(call: FakeCall): FakeResult | undefined {
  if (call.table === "merchants" && call.op === "select") return { data: state.merchant };
  if (call.table === "invoices" && call.op === "select") return { data: null };
  return { data: null, error: null };
}

const writes = (table: string, op?: string) => service.calls.filter((c) => c.table === table && c.op !== "select" && (!op || c.op === op));
const eventRows = () => writes("events", "insert").map((c) => c.payload as { kind: string; merchant: string; payload: unknown });
const rpcCall = (fn: string) => service.rpcCalls.find((c) => c.fn === fn);

let userInfoResponse: () => Response;

beforeEach(() => {
  vi.stubEnv("SALLA_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  vi.stubEnv("ZATCA_CSID", "");
  state.claim = "new";
  state.authorizeOutcome = { outcome: "pending_saved" };
  state.merchant = null;
  reportError.mockReset();
  service = createFakeSupabase("service", handler, (fn) => {
    if (fn === "claim_webhook_event") return { data: state.claim };
    if (fn === "salla_record_authorization") return { data: state.authorizeOutcome };
    throw new Error(`unexpected rpc ${fn}`);
  });
  // user/info for the authorizing user — the documented sample, for the webhook's store
  userInfoResponse = () =>
    new Response(JSON.stringify({ ...userInfo, data: { ...userInfo.data, merchant: { ...userInfo.data.merchant, id: authorizeEvent.merchant } } }), {
      status: 200
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://accounts.salla.sa/oauth2/user/info") return userInfoResponse();
      throw new Error(`unexpected fetch ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/salla/webhook — authentication", () => {
  it("refuses unsigned or mis-signed deliveries and says so when the secret is not configured", async () => {
    expect((await POST(signed(authorizeEvent, "wrong-secret"))).status).toBe(401);
    vi.stubEnv("SALLA_WEBHOOK_SECRET", "");
    const res = await POST(signed(authorizeEvent));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("acknowledges a duplicate delivery without processing it again", async () => {
    state.claim = "duplicate";
    const res = await POST(signed(authorizeEvent));
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(rpcCall("salla_record_authorization")).toBeUndefined();
  });
});

describe("app.store.authorize (Easy Mode, docs.salla.dev/doc-421413)", () => {
  it("stores the tokens encrypted with the installer identity, and never logs them", async () => {
    const res = await POST(signed(authorizeEvent));
    expect(res.status).toBe(200);

    const call = rpcCall("salla_record_authorization");
    expect(call?.args).toMatchObject({
      p_salla_merchant_id: String(authorizeEvent.merchant),
      p_expires_at: new Date(authorizeEvent.data.expires * 1000).toISOString(), // unix timestamp → 2021-10-21T12:31:24Z
      p_scope: authorizeEvent.data.scope,
      p_owner_email: "test@gmail.com",
      p_owner_role: "user",
      p_store_name: "User Name",
      p_store_domain: "https://www.domain.com"
    });
    expect(String(call?.args.p_access_token)).toMatch(/^enc:v1:/);
    expect(decryptSecret(String(call?.args.p_access_token))).toBe(authorizeEvent.data.access_token);
    expect(decryptSecret(String(call?.args.p_refresh_token))).toBe(authorizeEvent.data.refresh_token);

    const logged = JSON.stringify(eventRows());
    expect(eventRows().map((e) => e.kind)).toEqual(["salla.app.store.authorize"]);
    expect(logged).not.toContain(authorizeEvent.data.access_token);
    expect(logged).not.toContain(authorizeEvent.data.refresh_token);
    expect(logged).not.toContain("test@gmail.com");
  });

  it("does not attach an installer from another store to this install", async () => {
    userInfoResponse = () => new Response(JSON.stringify(userInfo), { status: 200 }); // documented sample: store 847769313
    expect((await POST(signed(authorizeEvent))).status).toBe(200);
    expect(rpcCall("salla_record_authorization")?.args).toMatchObject({ p_owner_email: null, p_owner_role: null });
  });

  it("keeps the tokens but fails the delivery when user/info is down, so Salla's retry can identify the owner", async () => {
    userInfoResponse = () => new Response("unavailable", { status: 503 });
    const res = await POST(signed(authorizeEvent));
    expect(res.status).toBe(500);
    expect(decryptSecret(String(rpcCall("salla_record_authorization")?.args.p_access_token))).toBe(authorizeEvent.data.access_token);
    // the claim is released so the redelivery is processed, not swallowed as a duplicate
    const release = writes("webhook_events", "update").find((c) => (c.payload as { status?: string }).status === "failed");
    expect(release).toBeDefined();
    expect(JSON.stringify(release?.payload)).not.toContain(authorizeEvent.data.access_token);
  });

  it("a linked store's re-authorization needs no installer identity to succeed", async () => {
    userInfoResponse = () => new Response("unavailable", { status: 503 });
    state.authorizeOutcome = { outcome: "linked_updated", merchant_id: MERCHANT_ID };
    expect((await POST(signed(authorizeEvent))).status).toBe(200);
  });

  it("records (and does not retry) an authorize payload that is not the documented shape", async () => {
    const res = await POST(signed({ event: "app.store.authorize", merchant: 1, created_at: "x", data: { refresh_token: "rt-leak" } }));
    expect(res.status).toBe(200);
    expect(rpcCall("salla_record_authorization")).toBeUndefined();
    expect(eventRows().map((e) => e.kind)).toEqual(["salla.app.store.authorize.invalid"]);
    expect(JSON.stringify(eventRows())).not.toContain("rt-leak");
  });
});

describe("other app events", () => {
  it("app.uninstalled clears the store's tokens and its parked install", async () => {
    expect((await POST(signed(uninstalledEvent))).status).toBe(200);
    const update = writes("merchants", "update")[0];
    expect(update.payload).toMatchObject({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      salla_refresh_lease: null,
      salla_token_invalid_at: null
    });
    expect((update.payload as { uninstalled_at?: string }).uninstalled_at).toBeTruthy();
    expect(update.filters).toEqual([["eq", "salla_merchant_id", String(uninstalledEvent.merchant)]]);
    expect(writes("salla_installs", "delete")[0].filters).toEqual([["eq", "salla_merchant_id", String(uninstalledEvent.merchant)]]);
    expect(eventRows().map((e) => e.kind)).toEqual(["salla.uninstalled"]);
  });

  it("strips credential fields at any depth before logging an unhandled event", async () => {
    const res = await POST(
      signed({
        event: "app.settings.updated",
        merchant: 42,
        created_at: "2022-12-31 12:31:25",
        data: { id: 9, settings: { access_token: "AT-SECRET", nested: [{ refresh_token: "RT-SECRET", keep: "me" }] } }
      })
    );
    expect(res.status).toBe(200);
    const [row] = eventRows();
    expect(row.kind).toBe("app.settings.updated");
    expect(row.payload).toEqual({
      event: "app.settings.updated",
      merchant: 42,
      created_at: "2022-12-31 12:31:25",
      data: { id: 9, settings: { nested: [{ keep: "me" }] } }
    });
  });

  it("fails the delivery when the events log write fails (so Salla redelivers)", async () => {
    service = createFakeSupabase(
      "service",
      (call) => (call.table === "events" ? { error: { code: "57014", message: "statement timeout" } } : handler(call)),
      (fn) => (fn === "claim_webhook_event" ? { data: "new" } : { data: null })
    );
    expect((await POST(signed({ event: "app.installed", merchant: 42, created_at: "t", data: { id: 1 } }))).status).toBe(500);
  });
});

describe("order.created (docs.salla.dev/doc-433804)", () => {
  beforeEach(() => {
    state.merchant = {
      id: MERCHANT_ID,
      salla_merchant_id: String(orderCreatedEvent.merchant),
      seller_name: "Bait Al Oud",
      vat_number: "300000000000003",
      cr_number: "1010101010",
      seller_address: { street: "King Fahd Rd", building: "1234", city: "Riyadh", postalCode: "12211" },
      zatca_csid: null
    };
  });

  it("invoices the documented order for exactly data.amounts.total", async () => {
    expect((await POST(signed(orderCreatedEvent))).status).toBe(200);
    const [insert] = writes("invoices", "insert");
    expect(insert.payload).toMatchObject({
      merchant_id: MERCHANT_ID,
      salla_order_id: String(orderCreatedEvent.data.id),
      subtotal: 196,
      vat: 0,
      total: orderCreatedEvent.data.amounts.total.amount
    });
    const xml = String((insert.payload as { xml: string }).xml);
    expect(xml).toContain("<cbc:IssueDate>2022-06-26</cbc:IssueDate>");
    expect(xml).toContain("<cbc:IssueTime>09:21:45</cbc:IssueTime>"); // 12:21:45 Asia/Riyadh (generator prints UTC)
    expect(xml).toContain('<cbc:PriceAmount currencyID="SAR">181.00</cbc:PriceAmount>');
    expect(xml).toContain("<cbc:RegistrationName>Mohammed Ali</cbc:RegistrationName>");
    expect(eventRows()).toHaveLength(0);
  });

  it("records an order whose totals do not reconcile instead of invoicing it", async () => {
    const tampered = structuredClone(orderCreatedEvent);
    tampered.data.amounts.total.amount = 250;
    expect((await POST(signed(tampered))).status).toBe(200);
    expect(writes("invoices", "insert")).toHaveLength(0);
    const [row] = eventRows();
    expect(row).toMatchObject({ kind: "salla.order.unmapped", merchant: MERCHANT_ID });
    expect(row.payload).toMatchObject({ reason: "totals_do_not_reconcile", order_id: String(orderCreatedEvent.data.id) });
    expect(reportError).toHaveBeenCalled();
  });

  it("records a payload that is not the documented order model (no silent zero-priced invoice)", async () => {
    const legacy = { event: "order.created", merchant: orderCreatedEvent.merchant, created_at: "t", data: { id: 5, items: [{ name: "x", price: 10 }] } };
    expect((await POST(signed(legacy))).status).toBe(200);
    expect(writes("invoices", "insert")).toHaveLength(0);
    expect(eventRows()[0].payload).toMatchObject({ reason: "invalid_payload", order_id: "5" });
  });

  it("ignores orders of stores that are not linked to a merchant", async () => {
    state.merchant = null;
    expect((await POST(signed(orderCreatedEvent))).status).toBe(200);
    expect(writes("invoices")).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });
});
