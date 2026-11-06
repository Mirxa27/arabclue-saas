/**
 * UI-012 / UI-013 / SW-2 / F14 — the invoice routes:
 *   POST /api/zatca/invoice/[id]           resubmit / reissue; gated (402/503/409), no platform CSID
 *   GET  /api/zatca/invoice/[id]/download  XML (cleared preferred, ZATCA file name) / QR PNG
 *   GET  /api/invoices/export              CSV (BOM, bilingual headers, same filters as the page)
 *   GET  /api/invoices/[id]/print          printable page: escaped, CSP, labelled browser PDF
 *   GET/POST /api/invoices/pending         counts / issue now
 *   GET  /api/zatca/sweep                  CRON_SECRET required
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import orderCreatedEvent from "../fixtures/salla-order-created.json";
import { fakeFatoora, type FakeFatoora } from "../helpers/zatca-fakes";
import { zatcaMemoryDb, type ZatcaMemoryDb } from "../helpers/zatca-db";
import type { SallaWebhookEvent } from "@/lib/salla/oauth";

const h = vi.hoisted(() => ({ db: null as unknown as ZatcaMemoryDb, merchant: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db/supabase", () => ({ getServerSupabase: async () => h.db.client, getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.merchant) throw new actual.AuthError();
      return h.merchant;
    })
  };
});
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => null)
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { POST as resubmit, GET as getInvoice } from "@/app/api/zatca/invoice/[id]/route";
import { GET as download } from "@/app/api/zatca/invoice/[id]/download/route";
import { GET as exportCsv } from "@/app/api/invoices/export/route";
import { GET as print } from "@/app/api/invoices/[id]/print/route";
import { GET as pendingGet, POST as pendingPost } from "@/app/api/invoices/pending/route";
import { GET as sweep } from "@/app/api/zatca/sweep/route";
import { runOnboarding } from "@/lib/zatca/onboarding";
import { getZatcaConfig } from "@/lib/zatca/config";
import { handleSallaOrderCreated } from "@/lib/invoices/salla-orders";

const MERCHANT_ID = "00000000-0000-4000-8000-00000000c0de";
const STORE = String(orderCreatedEvent.merchant);
const merchant = (patch: Record<string, unknown> = {}) => ({
  id: MERCHANT_ID,
  salla_merchant_id: STORE,
  salla_store_name: "Oud House",
  plan: "lite",
  subscription_status: "active",
  seller_name: "بيت العود Bait Al Oud",
  vat_number: "399999999900003",
  cr_number: "1010010000",
  seller_address: { street: "King Fahd Rd", building: "1234", district: "Al Olaya", city: "Riyadh", postalCode: "12211" },
  store_url: null,
  zatca_onboarded_at: null,
  ...patch
});

function order15(id: number, buyerFirst = "Mohammed"): SallaWebhookEvent {
  const evt = structuredClone(orderCreatedEvent) as Record<string, any>;
  evt.data.id = id;
  evt.data.reference_id = 5000 + id;
  evt.data.customer = { ...evt.data.customer, first_name: buyerFirst, last_name: "Ali" };
  evt.data.amounts = {
    sub_total: { amount: 186, currency: "SAR" },
    shipping_cost: { amount: 15, currency: "SAR" },
    cash_on_delivery: { amount: 0, currency: "SAR" },
    tax: { percent: "15.00", amount: { amount: 29.4, currency: "SAR" } },
    discounts: [{ title: "offer", type: "special", code: "x", discount: "5.00", discounted_shipping: 0 }],
    total: { amount: 225.4, currency: "SAR" }
  };
  evt.data.items = evt.data.items.map((it: Record<string, any>) => ({ ...it, amounts: { ...it.amounts, tax: { percent: "15.00", amount: { amount: 0, currency: "SAR" } } } }));
  return evt as unknown as SallaWebhookEvent;
}

let fatoora: FakeFatoora;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);

beforeEach(async () => {
  vi.stubEnv("ZATCA_ENVIRONMENT", "sandbox");
  vi.stubEnv("ZATCA_FATOORA_BASE", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  vi.stubEnv("ZATCA_CSID", "PLATFORM-CSID-MUST-NOT-BE-USED");
  h.db = zatcaMemoryDb();
  h.merchant = merchant();
  h.db.tables.merchants.push(merchant());
  fatoora = fakeFatoora();
  vi.stubGlobal("fetch", fatoora.fetch);
  await runOnboarding(h.db.client, merchant() as never, getZatcaConfig()!, { otp: "123345" }, { fetch: fatoora.fetch });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function oneFailedInvoice() {
  fatoora.respond.set("/invoices/reporting/single", () => new Response("", { status: 503 }));
  await handleSallaOrderCreated(h.db.client, order15(1, '<img src=x onerror="alert(1)">'));
  fatoora.respond.delete("/invoices/reporting/single");
  return h.db.tables.invoices[0];
}

describe("POST /api/zatca/invoice/[id] (resubmit)", () => {
  it("resends an undelivered invoice with the merchant's own EGS credential — never a platform CSID", async () => {
    const inv = await oneFailedInvoice();
    const res = await resubmit(req(`http://localhost/api/zatca/invoice/${inv.id}`, { method: "POST" }), params(String(inv.id)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: "resubmitted", submission: { status: "reported" } });
    const auth = fatoora.calls.filter((c) => c.path === "/invoices/reporting/single").map((c) => c.headers.authorization);
    expect(auth.every((a) => a && !Buffer.from(a.replace("Basic ", ""), "base64").toString().includes("PLATFORM"))).toBe(true);
  });

  it("402 for an unpaid merchant (SW-2) and 409 'onboard first' without an EGS unit — no ZATCA call", async () => {
    const inv = await oneFailedInvoice();
    const before = fatoora.calls.length;
    h.merchant = merchant({ subscription_status: "pending" });
    let res = await resubmit(req(`http://localhost/api/zatca/invoice/${inv.id}`, { method: "POST" }), params(String(inv.id)));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("plan_required");
    h.merchant = merchant();
    h.db.tables.zatca_egs_units.length = 0;
    res = await resubmit(req(`http://localhost/api/zatca/invoice/${inv.id}`, { method: "POST" }), params(String(inv.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("onboard_first");
    expect(fatoora.calls.length).toBe(before);
  });

  it("404 for another merchant's invoice or a malformed id; 401 without a session", async () => {
    const inv = await oneFailedInvoice();
    h.merchant = merchant({ id: "00000000-0000-4000-8000-00000000beef" });
    expect((await resubmit(req(`http://localhost/api/zatca/invoice/${inv.id}`, { method: "POST" }), params(String(inv.id)))).status).toBe(404);
    expect((await getInvoice(req("http://localhost/api/zatca/invoice/x"), params("not-a-uuid"))).status).toBe(404);
    h.merchant = null as unknown as Record<string, unknown>;
    expect((await getInvoice(req(`http://localhost/api/zatca/invoice/${inv.id}`), params(String(inv.id)))).status).toBe(401);
  });
});

describe("downloads, CSV and print", () => {
  it("XML download: the signed document under ZATCA's file name; QR as a real PNG", async () => {
    await handleSallaOrderCreated(h.db.client, order15(2));
    const inv = h.db.tables.invoices[0];
    const res = await download(req(`http://localhost/api/zatca/invoice/${inv.id}/download?format=xml`), params(String(inv.id)));
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="399999999900003_\d{8}T\d{6}_INV-5002\.xml"/);
    expect(await res.text()).toBe(inv.xml);

    const qr = await download(req(`http://localhost/api/zatca/invoice/${inv.id}/download?format=qr`), params(String(inv.id)));
    expect(qr.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await qr.arrayBuffer()).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect((await download(req(`http://localhost/api/zatca/invoice/${inv.id}/download?format=pdf`), params(String(inv.id)))).status).toBe(400);
  });

  it("XML download prefers ZATCA's cleared document", async () => {
    await handleSallaOrderCreated(h.db.client, order15(3));
    const inv = h.db.tables.invoices[0];
    inv.cleared_xml = "<Invoice>stamped by ZATCA</Invoice>";
    const res = await download(req(`http://localhost/api/zatca/invoice/${inv.id}/download`), params(String(inv.id)));
    expect(await res.text()).toBe("<Invoice>stamped by ZATCA</Invoice>");
    const signed = await download(req(`http://localhost/api/zatca/invoice/${inv.id}/download?format=signed-xml`), params(String(inv.id)));
    expect(await signed.text()).toBe(inv.xml);
  });

  it("CSV export: BOM, bilingual headers, guarded cells, the page's filters", async () => {
    await handleSallaOrderCreated(h.db.client, order15(4, "=HYPERLINK(\"http://evil.example\")"));
    const res = await exportCsv(req("http://localhost/api/invoices/export?status=reported&q=INV"));
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="arabclue-invoices-\d{4}-\d{2}-\d{2}\.csv"/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 3).toString("hex")).toBe("efbbbf");
    const text = buf.toString("utf8");
    expect(text).toContain("Invoice number / رقم الفاتورة");
    expect(text).toContain("INV-5004");
    expect(text).toContain('"\'=HYPERLINK(""http://evil.example"") Ali"');
    const list = h.db.calls.filter((c) => c.table === "invoices" && c.op === "select" && c.columns?.includes("buyer_name"));
    expect(list.at(-1)!.filters).toEqual(
      expect.arrayContaining([
        ["eq", "merchant_id", MERCHANT_ID],
        ["eq", "status", "reported"],
        ["or", 'invoice_number.ilike."%INV%",buyer_name.ilike."%INV%"', undefined]
      ])
    );
  });

  it("print view: everything escaped, strict CSP, labelled as the browser's Save-as-PDF", async () => {
    await handleSallaOrderCreated(h.db.client, order15(5, "<script>alert(1)</script>"));
    const inv = h.db.tables.invoices[0];
    const res = await print(req(`http://localhost/api/invoices/${inv.id}/print`), params(String(inv.id)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*script-src 'sha256-/);
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Ali");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("فاتورة ضريبية مبسطة");
    expect(html).toContain("Save as PDF");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("ZATCA sandbox environment — test document, not a valid tax invoice");
  });
});

describe("pending orders and the sweep", () => {
  it("counts waiting orders and issues them on request", async () => {
    h.db.tables.merchants[0].subscription_status = "pending";
    await handleSallaOrderCreated(h.db.client, { ...(order15(6) as object), merchant: orderCreatedEvent.merchant } as SallaWebhookEvent);
    expect(await (await pendingGet()).json()).toMatchObject({ waiting: 1, byReason: { not_entitled: 1 } });
    h.db.tables.merchants[0].subscription_status = "active";
    const res = await pendingPost(req("http://localhost/api/invoices/pending", { method: "POST" }));
    expect(await res.json()).toMatchObject({ invoiced: 1, remaining: { waiting: 0 } });
    h.merchant = merchant({ subscription_status: "pending" });
    expect((await pendingPost(req("http://localhost/api/invoices/pending", { method: "POST" }))).status).toBe(402);
  });

  it("the sweep requires CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await sweep(req("http://localhost/api/zatca/sweep"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret-for-tests");
    expect((await sweep(req("http://localhost/api/zatca/sweep", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const ok = await sweep(req("http://localhost/api/zatca/sweep", { headers: { authorization: "Bearer cron-secret-for-tests" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ resent: 0, pendingInvoiced: 0, stoppedEarly: false });
  });
});
