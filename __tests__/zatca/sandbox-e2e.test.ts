/**
 * LIVE end-to-end test against ZATCA's developer-portal sandbox — runs only with
 *   ZATCA_SANDBOX_E2E=1 npx vitest run __tests__/zatca/sandbox-e2e.test.ts
 * (optionally ZATCA_E2E_TRANSCRIPT=/path/file.json to keep the redacted request/response log).
 *
 * Drives the product code — runOnboarding, handleSallaOrderCreated, issueDocument, submitInvoice —
 * with the real Fatoora API (only the database is in memory):
 *   compliance CSID for our CSR (OTP 123345) → all six compliance checks PASS → production CSID →
 *   a Salla order invoiced as a simplified invoice and REPORTED → a standard invoice CLEARED.
 * The sandbox's production certificate is ZATCA's fixed test certificate for VAT 399999999900003,
 * so the seller uses that VAT number.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "fs";
import orderCreatedEvent from "../fixtures/salla-order-created.json";
import { zatcaMemoryDb, type ZatcaMemoryDb } from "../helpers/zatca-db";
import type { SallaWebhookEvent } from "@/lib/salla/oauth";

const enabled = process.env.ZATCA_SANDBOX_E2E === "1";
const h = vi.hoisted(() => ({ db: null as unknown as ZatcaMemoryDb }));
vi.mock("@/lib/db/supabase", () => ({ getServerSupabase: async () => h.db.client, getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn((err: unknown) => console.error("reportError", err))
}));

import { runOnboarding } from "@/lib/zatca/onboarding";
import { getZatcaConfig } from "@/lib/zatca/config";
import { handleSallaOrderCreated } from "@/lib/invoices/salla-orders";
import { issueDocument, submitInvoice } from "@/lib/zatca/issue";
import { loadEgsRow, signingMaterial } from "@/lib/zatca/egs-store";
import { sellerFromMerchant } from "@/lib/zatca/seller";

type Entry = { request: { method: string; path: string; headers: Record<string, string>; body: unknown }; response: { status: number; body: unknown }; at: string };
const transcript: Entry[] = [];
const realFetch = globalThis.fetch;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        if (k === "secret") return [k, `<redacted ${String(v).length} chars>`];
        if (k === "binarySecurityToken" || k === "invoice" || k === "clearedInvoice" || k === "csr")
          return [k, typeof v === "string" ? `${v.slice(0, 24)}…(${v.length} chars)` : v];
        return [k, redact(v)];
      })
    );
  }
  return value;
}

const loggingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const res = await realFetch(input, init);
  const text = await res.clone().text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text body */
  }
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k, k.toLowerCase() === "authorization" ? "Basic <redacted>" : v]));
  transcript.push({
    request: { method: init?.method ?? "GET", path: url.pathname, headers, body: redact(init?.body ? JSON.parse(String(init.body)) : null) },
    response: { status: res.status, body: redact(body) },
    at: new Date().toISOString()
  });
  return res;
}) as typeof fetch;

const MERCHANT = {
  id: "00000000-0000-4000-8000-0000000e2e01",
  salla_merchant_id: String(orderCreatedEvent.merchant),
  salla_store_name: "arabclue sandbox store",
  plan: "lite",
  subscription_status: "active",
  seller_name: "شركة بيت العود للتجارة | Bait Al Oud Trading",
  vat_number: "399999999900003",
  cr_number: "1010010000",
  seller_address: { street: "طريق الملك فهد | King Fahd Rd", building: "2322", district: "العليا | Al Olaya", city: "الرياض | Riyadh", postalCode: "12211" },
  store_url: "https://oud.example",
  zatca_onboarded_at: null
};

describe.skipIf(!enabled)("ZATCA developer-portal sandbox, end to end", () => {
  beforeAll(() => {
    vi.stubEnv("ZATCA_ENVIRONMENT", "sandbox");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "e2e-token-encryption-key-32-chars-min");
    vi.stubGlobal("fetch", loggingFetch);
    h.db = zatcaMemoryDb();
    h.db.tables.merchants.push({ ...MERCHANT });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (process.env.ZATCA_E2E_TRANSCRIPT) writeFileSync(process.env.ZATCA_E2E_TRANSCRIPT, JSON.stringify(transcript, null, 2));
  });

  it("onboards: compliance CSID → six compliance checks PASS → production CSID", async () => {
    const status = await runOnboarding(h.db.client, MERCHANT as never, getZatcaConfig()!, { otp: "123345" });
    expect(status.lastError).toBeNull();
    expect(status.checks.map((c) => [c.kind, c.status, c.errors.length, c.warnings.length])).toEqual(
      ["standard_invoice", "standard_credit_note", "standard_debit_note", "simplified_invoice", "simplified_credit_note", "simplified_debit_note"].map((k) => [k, "passed", 0, 0])
    );
    expect(status.onboarded).toBe(true);
  }, 120_000);

  it("invoices a Salla order as a simplified invoice and ZATCA REPORTS it with zero errors and warnings", async () => {
    const evt = structuredClone(orderCreatedEvent) as Record<string, any>;
    evt.data.id = Date.now();
    evt.data.amounts.tax = { percent: "15.00", amount: { amount: 29.4, currency: "SAR" } };
    evt.data.amounts.total.amount = 225.4;
    evt.data.items = evt.data.items.map((it: Record<string, any>) => ({ ...it, amounts: { ...it.amounts, tax: { percent: "15.00", amount: { amount: 0, currency: "SAR" } } } }));
    const outcome = await handleSallaOrderCreated(h.db.client, evt as unknown as SallaWebhookEvent);
    expect(outcome).toMatchObject({ outcome: "invoiced", submission: { status: "reported", errors: [], warnings: [] } });
    const reported = transcript.filter((t) => t.request.path.endsWith("/invoices/reporting/single")).at(-1)!;
    expect(reported.response).toMatchObject({ status: 200, body: { reportingStatus: "REPORTED", validationResults: { status: "PASS" } } });
  }, 60_000);

  it("clears a standard invoice with zero errors and stores ZATCA's cleared XML", async () => {
    const row = (await loadEgsRow(h.db.client, MERCHANT.id))!;
    const cfg = getZatcaConfig()!;
    const issued = await issueDocument(h.db.client, MERCHANT.id, cfg, signingMaterial(row), {
      invoiceType: "standard",
      documentType: "invoice",
      invoiceNumber: `B2B-${Date.now()}`,
      seller: sellerFromMerchant(MERCHANT as never),
      buyer: {
        name: "شركة نماذج فاتورة المحدودة | Fatoora Samples LTD",
        vatNumber: "399999999800003",
        address: { street: "صلاح الدين | Salah Al-Din", building: "1111", district: "المروج | Al-Murooj", city: "الرياض | Riyadh", postalCode: "12222", countryCode: "SA" }
      },
      lines: [
        { name: "دهن عود ملكي | Royal oud oil", quantity: 12, unitPrice: 95.5, vatRate: 0.15 },
        { name: "بخور | Bakhoor", quantity: 3, unitPrice: 33.333333333333336, vatRate: 0.15 }
      ],
      supplyDate: new Date()
    });
    const inv = h.db.tables.invoices.find((i) => i.id === issued.invoiceId)!;
    const result = await submitInvoice(h.db.client, inv as never, cfg, signingMaterial(row));
    expect(result).toMatchObject({ status: "cleared", errors: [], warnings: [] });
    expect(String(inv.cleared_xml)).toContain("<ds:X509IssuerName>"); // ZATCA's stamp
    const cleared = transcript.filter((t) => t.request.path.endsWith("/invoices/clearance/single")).at(-1)!;
    expect(cleared.response).toMatchObject({ status: 200, body: { clearanceStatus: "CLEARED", validationResults: { status: "PASS" } } });
  }, 60_000);
});
