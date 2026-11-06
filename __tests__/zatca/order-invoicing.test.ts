/**
 * Salla order → ZATCA invoice (lib/invoices/*, lib/zatca/issue.ts) against the in-process Fatoora
 * and the in-memory ZATCA tables (same semantics as the SQL proved by supabase/tests/45–47):
 *  - F09: ICV/PIH chain, concurrent orders, idempotent redelivery (one live invoice per order);
 *  - F14: simplified → reported (signature, hash and QR re-validated by the fake), standard → cleared
 *    with ZATCA's XML stored; rejection stored with ZATCA's errors; reissue as a new document;
 *    transport failure → 'failed' → resent unchanged;
 *  - RB-S3 / SW-2: unlinked store, unpaid, kill switch, not onboarded → recorded as pending, never
 *    invoiced for free, invoiced once the reason is gone; 0% orders recorded as unmapped;
 *  - the sweep resends and drains the backlog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import orderCreatedEvent from "../fixtures/salla-order-created.json";
import { fakeFatoora, type FakeFatoora } from "../helpers/zatca-fakes";
import { zatcaMemoryDb, type ZatcaMemoryDb } from "../helpers/zatca-db";
import { decodeQrPayload } from "@/lib/zatca/qr";
import { parseXml } from "@/lib/zatca/xml-parse";
import { computeInvoiceHash } from "@/lib/zatca/signing";
import { GENESIS_PREVIOUS_INVOICE_HASH } from "@/lib/zatca/invoice";
import type { SallaWebhookEvent } from "@/lib/salla/oauth";

const h = vi.hoisted(() => ({ db: null as unknown as ZatcaMemoryDb }));
vi.mock("@/lib/db/supabase", () => ({ getServerSupabase: async () => h.db.client, getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { runOnboarding } from "@/lib/zatca/onboarding";
import { getZatcaConfig } from "@/lib/zatca/config";
import { handleSallaOrderCreated } from "@/lib/invoices/salla-orders";
import { processPendingOrders } from "@/lib/invoices/pending-orders";
import { resubmitInvoice } from "@/lib/invoices/resubmit";
import { runZatcaSweep } from "@/lib/zatca/sweep";
import { issueDocument } from "@/lib/zatca/issue";
import { signingMaterial, loadEgsRow } from "@/lib/zatca/egs-store";
import { sellerFromMerchant } from "@/lib/zatca/seller";

const MERCHANT_ID = "00000000-0000-4000-8000-00000000f0a1";
const STORE = String(orderCreatedEvent.merchant);

const merchantRow = (patch: Record<string, unknown> = {}) => ({
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

/** The documented order with 15% VAT on items and shipping (Salla's sample itself is 0%). */
function order15(id: number, patch: (o: Record<string, any>) => void = () => undefined): SallaWebhookEvent {
  const evt = structuredClone(orderCreatedEvent) as Record<string, any>;
  evt.data.id = id;
  evt.data.reference_id = 41000000 + id;
  evt.data.amounts = {
    sub_total: { amount: 186, currency: "SAR" },
    shipping_cost: { amount: 15, currency: "SAR" },
    cash_on_delivery: { amount: 0, currency: "SAR" },
    tax: { percent: "15.00", amount: { amount: 29.4, currency: "SAR" } },
    discounts: [{ title: "new offer", type: "special", code: "new offer", discount: "5.00", discounted_shipping: 0 }],
    total: { amount: 225.4, currency: "SAR" }
  };
  evt.data.items = evt.data.items.map((it: Record<string, any>) => ({ ...it, amounts: { ...it.amounts, tax: { percent: "15.00", amount: { amount: 0, currency: "SAR" } } } }));
  patch(evt.data);
  return evt as unknown as SallaWebhookEvent;
}

let fatoora: FakeFatoora;

async function onboard() {
  const cfg = getZatcaConfig()!;
  const status = await runOnboarding(h.db.client, h.db.tables.merchants[0] as never, cfg, { otp: "123345" }, { fetch: fatoora.fetch });
  expect(status.onboarded).toBe(true);
}

const invoices = () => [...h.db.tables.invoices].sort((a, b) => Number(a.icv) - Number(b.icv));
const pending = () => h.db.tables.pending_salla_orders;
const calls = (path: string) => fatoora.calls.filter((c) => c.path === path);

beforeEach(async () => {
  vi.stubEnv("ZATCA_ENVIRONMENT", "sandbox");
  vi.stubEnv("ZATCA_FATOORA_BASE", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  h.db = zatcaMemoryDb();
  h.db.tables.merchants.push(merchantRow());
  fatoora = fakeFatoora();
  vi.stubGlobal("fetch", fatoora.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("an onboarded, entitled merchant", () => {
  beforeEach(onboard);

  it("issues a signed simplified invoice, chained from the genesis hash, and reports it", async () => {
    const outcome = await handleSallaOrderCreated(h.db.client, order15(1));
    expect(outcome).toMatchObject({ outcome: "invoiced", submission: { status: "reported", errors: [] } });
    const [inv] = invoices();
    expect(inv).toMatchObject({
      icv: 1,
      previous_invoice_hash: GENESIS_PREVIOUS_INVOICE_HASH,
      status: "reported",
      invoice_type: "simplified",
      environment: "sandbox",
      salla_order_id: "1",
      invoice_number: "INV-41000001",
      subtotal: "196.00",
      vat: "29.40",
      total: "225.40",
      buyer_name: "Mohammed Ali"
    });
    // the stored XML is the document ZATCA validated: its hash recomputes, the QR carries tags 1–9
    expect(computeInvoiceHash(parseXml(String(inv.xml)))).toBe(inv.invoice_hash);
    const qr = decodeQrPayload(String(inv.qr_base64));
    expect(qr.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(qr).toMatchObject({ totalWithVat: "225.40", vatTotal: "29.40", invoiceHash: inv.invoice_hash });
    expect(calls("/invoices/reporting/single")).toHaveLength(1);
    expect((inv.issue_input as { lines: unknown[] }).lines).toHaveLength(2); // the item + shipping, kept for a reissue
  });

  it("chains the next order to the previous hash and answers a redelivery with the same invoice", async () => {
    await handleSallaOrderCreated(h.db.client, order15(1));
    await handleSallaOrderCreated(h.db.client, order15(2));
    const again = await handleSallaOrderCreated(h.db.client, order15(1));
    expect(again).toMatchObject({ outcome: "already_invoiced", submission: null });
    const [a, b] = invoices();
    expect(invoices()).toHaveLength(2);
    expect(b).toMatchObject({ icv: 2, previous_invoice_hash: a.invoice_hash });
    expect(calls("/invoices/reporting/single")).toHaveLength(2);
  });

  it("concurrent orders never share an ICV or fork the chain (head_moved → re-signed)", async () => {
    await Promise.all([1, 2, 3, 4].map((id) => handleSallaOrderCreated(h.db.client, order15(id))));
    const list = invoices();
    expect(list.map((i) => i.icv)).toEqual([1, 2, 3, 4]);
    list.forEach((inv, i) => expect(inv.previous_invoice_hash).toBe(i === 0 ? GENESIS_PREVIOUS_INVOICE_HASH : list[i - 1].invoice_hash));
    expect(new Set(list.map((i) => i.salla_order_id)).size).toBe(4);
    expect(list.every((i) => i.status === "reported")).toBe(true);
    expect(h.db.rpcCounts.zatca_append_invoice).toBeGreaterThan(4); // some appends were refused and re-signed
  });

  it("clears a standard (B2B) document and keeps ZATCA's cleared XML as the legal document", async () => {
    const row = (await loadEgsRow(h.db.client, MERCHANT_ID))!;
    const cfg = getZatcaConfig()!;
    const issued = await issueDocument(h.db.client, MERCHANT_ID, cfg, signingMaterial(row), {
      invoiceType: "standard",
      documentType: "invoice",
      invoiceNumber: "B2B-1",
      seller: sellerFromMerchant(merchantRow() as never),
      buyer: { name: "Fatoora Samples LTD", vatNumber: "399999999800003", address: { street: "Salah Al-Din", building: "1111", district: "Al-Murooj", city: "Riyadh", postalCode: "12222" } },
      lines: [{ name: "Wholesale oud", quantity: 10, unitPrice: 95.5, vatRate: 0.15 }]
    });
    const { submitInvoice } = await import("@/lib/zatca/issue");
    const inv = h.db.tables.invoices.find((i) => i.id === issued.invoiceId)!;
    const result = await submitInvoice(h.db.client, inv as never, cfg, signingMaterial(row));
    expect(result.status).toBe("cleared");
    expect(calls("/invoices/clearance/single")[0].headers["clearance-status"]).toBe("1");
    expect(inv.cleared_xml).toBe(inv.xml); // the fake returns the submitted document as "cleared"
    expect(inv.status).toBe("cleared");
  });

  it("stores ZATCA's errors for a rejected invoice and reissues a corrected NEW document", async () => {
    fatoora.respond.set("/invoices/reporting/single", () =>
      new Response(
        JSON.stringify({
          validationResults: { infoMessages: [], warningMessages: [], errorMessages: [{ type: "ERROR", code: "BR-KSA-66", category: "KSA", message: "postal code", status: "ERROR" }], status: "ERROR" },
          reportingStatus: "NOT_REPORTED"
        }),
        { status: 400 }
      )
    );
    await handleSallaOrderCreated(h.db.client, order15(1));
    const [rejected] = invoices();
    expect(rejected).toMatchObject({ status: "rejected", validation_errors: [{ code: "BR-KSA-66", message: "postal code" }] });

    fatoora.respond.delete("/invoices/reporting/single");
    const result = await resubmitInvoice(h.db.client, merchantRow() as never, String(rejected.id));
    expect(result).toMatchObject({ action: "reissued", replaces: rejected.id, submission: { status: "reported" } });
    const reissue = h.db.tables.invoices.find((i) => i.id === result.invoiceId)!;
    expect(reissue).toMatchObject({ invoice_number: "INV-41000001-R1", icv: 2, previous_invoice_hash: rejected.invoice_hash, reissue_of: rejected.id, salla_order_id: "1" });
    expect(reissue.uuid).not.toBe(rejected.uuid);
    expect(rejected).toMatchObject({ status: "rejected", superseded_by: reissue.id }); // the rejected record itself is never rewritten

    await expect(resubmitInvoice(h.db.client, merchantRow() as never, String(rejected.id))).rejects.toMatchObject({ status: 409, code: "superseded" });
    await expect(resubmitInvoice(h.db.client, merchantRow() as never, String(reissue.id))).rejects.toMatchObject({ status: 409, code: "already_accepted" });
  });

  it("leaves an undelivered invoice 'failed' (the webhook still succeeds) and resends the same document later", async () => {
    fatoora.respond.set("/invoices/reporting/single", () => new Response("", { status: 503 }));
    const outcome = await handleSallaOrderCreated(h.db.client, order15(1));
    expect(outcome).toMatchObject({ outcome: "invoiced", submission: { status: "failed", retryable: true } });
    const [inv] = invoices();
    expect(inv).toMatchObject({ status: "failed", submission_attempts: 1 });

    fatoora.respond.delete("/invoices/reporting/single");
    const result = await resubmitInvoice(h.db.client, merchantRow() as never, String(inv.id));
    expect(result).toMatchObject({ action: "resubmitted", invoiceId: inv.id, submission: { status: "reported" } });
    const sent = calls("/invoices/reporting/single");
    expect(sent.at(-1)!.body.uuid).toBe(inv.uuid); // same document, same UUID
    expect(invoices()).toHaveLength(1);
  });

  it("records a 0% VAT order as unmapped instead of issuing a document ZATCA would reject", async () => {
    const outcome = await handleSallaOrderCreated(h.db.client, orderCreatedEvent as unknown as SallaWebhookEvent);
    expect(outcome).toEqual({ outcome: "unmapped", reason: "unsupported_vat_rate" });
    expect(invoices()).toHaveLength(0);
    expect(h.db.tables.events.map((e) => e.kind)).toEqual(["salla.order.unmapped"]);
  });
});

describe("orders that cannot be invoiced yet are recorded, never dropped or invoiced for free", () => {
  it("RB-S3: an unlinked store's order waits and is invoiced once the store is linked", async () => {
    h.db.tables.merchants[0].salla_merchant_id = null;
    expect(await handleSallaOrderCreated(h.db.client, order15(7))).toEqual({ outcome: "pending", reason: "store_unlinked" });
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({ salla_store_id: STORE, salla_order_id: "7", merchant_id: null, reason: "store_unlinked", status: "pending" });
    // minimised: the customer's e-mail and phone are not stored
    expect(JSON.stringify(pending()[0].order_payload)).not.toMatch(/@|mobile/);
    expect(invoices()).toHaveLength(0);

    h.db.tables.merchants[0].salla_merchant_id = STORE; // claimed / linked
    await onboard();
    const run = await processPendingOrders(h.db.client, h.db.tables.merchants[0] as never);
    expect(run).toMatchObject({ claimed: 1, invoiced: 1 });
    expect(pending()[0]).toMatchObject({ merchant_id: MERCHANT_ID, status: "invoiced", invoice_id: invoices()[0].id });
    expect(invoices()[0]).toMatchObject({ salla_order_id: "7", status: "reported" });
  });

  it("SW-2: an unpaid merchant's order waits — no ICV consumed, no ZATCA call — and is invoiced after activation", async () => {
    await onboard();
    const before = fatoora.calls.length;
    h.db.tables.merchants[0].subscription_status = "pending";
    expect(await handleSallaOrderCreated(h.db.client, order15(8))).toEqual({ outcome: "pending", reason: "not_entitled" });
    expect(invoices()).toHaveLength(0);
    expect(h.db.rpcCounts.zatca_append_invoice).toBeUndefined();
    expect(fatoora.calls.length).toBe(before);
    expect(await processPendingOrders(h.db.client, h.db.tables.merchants[0] as never)).toMatchObject({ blockedBy: "not_entitled", invoiced: 0 });

    h.db.tables.merchants[0].subscription_status = "active";
    expect(await processPendingOrders(h.db.client, h.db.tables.merchants[0] as never)).toMatchObject({ invoiced: 1 });
    expect(invoices()[0]).toMatchObject({ icv: 1, salla_order_id: "8" });
  });

  it("SW-2: the kill switch and missing onboarding hold orders too", async () => {
    h.db.tables.platform_settings.push({ key: "features", value: { zatca: false } });
    expect(await handleSallaOrderCreated(h.db.client, order15(9))).toEqual({ outcome: "pending", reason: "zatca_disabled" });
    h.db.tables.platform_settings.length = 0;
    expect(await handleSallaOrderCreated(h.db.client, order15(10))).toEqual({ outcome: "pending", reason: "zatca_not_onboarded" });
    expect(pending().map((p) => p.reason)).toEqual(["zatca_disabled", "zatca_not_onboarded"]);
    expect(fatoora.calls).toHaveLength(0);
  });

  it("a database error while looking up the store's merchant fails the delivery (Salla retries)", async () => {
    const broken = zatcaMemoryDb();
    const client = broken.client as unknown as { from: (t: string) => unknown };
    const realFrom = client.from.bind(client);
    client.from = (t: string) => {
      if (t === "merchants") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "57014", message: "statement timeout" } }) }) }) };
      }
      return realFrom(t);
    };
    await expect(handleSallaOrderCreated(broken.client, order15(11))).rejects.toThrow(/statement timeout/);
  });
});

describe("runZatcaSweep", () => {
  it("resends undelivered documents, drains waiting orders and prunes unclaimed ones", async () => {
    await onboard();
    fatoora.respond.set("/invoices/reporting/single", () => new Response("", { status: 503 }));
    await handleSallaOrderCreated(h.db.client, order15(1));
    expect(invoices()[0].status).toBe("failed");
    fatoora.respond.delete("/invoices/reporting/single");
    // an order that waited for activation, and an old order of a store nobody claimed
    h.db.tables.pending_salla_orders.push({
      id: 900,
      salla_store_id: STORE,
      salla_order_id: "2",
      merchant_id: MERCHANT_ID,
      reason: "not_entitled",
      status: "pending",
      order_payload: (order15(2) as unknown as { data: unknown }).data,
      received_at: new Date().toISOString()
    });
    h.db.tables.pending_salla_orders.push({ id: 901, salla_store_id: "other", salla_order_id: "x", merchant_id: null, reason: "store_unlinked", status: "pending", order_payload: {}, received_at: "2020-01-01T00:00:00Z" });
    // the failed invoice was sent just now; the sweep waits 10 minutes before resending
    h.db.tables.invoices[0].submitted_at = new Date(Date.now() - 11 * 60_000).toISOString();

    const summary = await runZatcaSweep(h.db.client);
    expect(summary).toMatchObject({ resent: 1, pendingInvoiced: 1, prunedUnlinked: 1, stoppedEarly: false });
    expect(invoices().map((i) => [i.salla_order_id, i.status])).toEqual([
      ["1", "reported"],
      ["2", "reported"]
    ]);
    expect(pending().find((p) => p.id === 901)).toBeUndefined();
  });
});
