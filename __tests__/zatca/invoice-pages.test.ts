/**
 * UI-002 / UI-012 / UI-013 — the invoice pages are Server Components without event handlers:
 *  - no Server Component under app/ passes an on* handler prop (React Flight rejects them at
 *    request time, which `next build` does not catch — UI-002 broke every /invoices/[id]);
 *  - the detail page renders downloads as links, copy/resubmit as client islands and the QR from
 *    its TLV payload; the list page filters with a GET form and exports the same filters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { zatcaMemoryDb, type ZatcaMemoryDb } from "../helpers/zatca-db";

const h = vi.hoisted(() => ({ db: null as unknown as ZatcaMemoryDb, merchant: null as unknown as Record<string, unknown> }));
vi.mock("@/lib/db/supabase", () => ({ getServerSupabase: async () => h.db.client, getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getCurrentMerchant: vi.fn(async () => h.merchant)
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  }
}));

import InvoiceDetailPage from "@/app/(dashboard)/invoices/[id]/page";
import InvoicesPage from "@/app/(dashboard)/invoices/page";
import { CopyButton } from "@/components/dashboard/copy-button";
import { ResubmitButton } from "@/components/invoices/resubmit-button";

const ROOT = path.join(__dirname, "../..");
const MERCHANT_ID = "00000000-0000-4000-8000-00000000aaa1";
const INVOICE_ID = "00000000-0000-4000-8000-00000000bbb1";
// A Phase-2 QR payload (tags 1–5 suffice for rendering)
const QR = Buffer.concat([Buffer.from([1, 4]), Buffer.from("Shop"), Buffer.from([2, 15]), Buffer.from("399999999900003")]).toString("base64");

function serverComponents(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...serverComponents(p));
    else if (p.endsWith(".tsx") && !/^\s*["']use client["']/.test(readFileSync(p, "utf8"))) out.push(p);
  }
  return out;
}

/** Every element of a returned tree (also elements passed in other props, e.g. PageShell's title). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (isValidElement(node)) {
    out.push(node);
    for (const value of Object.values((node.props ?? {}) as Record<string, unknown>)) elements(value as ReactNode, out);
  }
  return out;
}

beforeEach(() => {
  h.db = zatcaMemoryDb();
  h.merchant = { id: MERCHANT_ID, plan: "lite", subscription_status: "active", vat_number: "399999999900003", salla_merchant_id: "store-1", seller_name: "Shop" };
  h.db.tables.invoices.push({
    id: INVOICE_ID,
    merchant_id: MERCHANT_ID,
    invoice_number: "INV-77",
    uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
    icv: 3,
    invoice_hash: "aGFzaA==",
    previous_invoice_hash: "cHJldg==",
    qr_base64: QR,
    xml: '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>INV-77</cbc:ID></Invoice>',
    status: "failed",
    invoice_type: "simplified",
    document_type: "invoice",
    environment: "sandbox",
    subtotal: 100,
    vat: 15,
    total: 115,
    buyer_name: "محمد",
    validation_errors: [{ code: "BR-KSA-66", message: "postal code" }],
    created_at: "2026-11-06T09:00:00.000Z"
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Server Components under app/", () => {
  it("never pass an event handler prop (only client components may)", () => {
    const offenders = serverComponents(path.join(ROOT, "app")).filter((file) => /\son[A-Z][A-Za-z]*=\{/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("/invoices/[id]", () => {
  it("renders without handler props, with download links, copy/resubmit islands and a QR image", async () => {
    const tree = await InvoiceDetailPage({ params: Promise.resolve({ id: INVOICE_ID }) });
    const all = elements(tree);
    const hostWithHandlers = all.filter((e) => typeof e.type === "string" && Object.entries(e.props as object).some(([k, v]) => /^on[A-Z]/.test(k) && typeof v === "function"));
    expect(hostWithHandlers).toEqual([]);
    const hrefs = all.filter((e) => e.type === "a").map((e) => (e.props as { href: string }).href);
    expect(hrefs).toEqual(expect.arrayContaining([`/api/zatca/invoice/${INVOICE_ID}/download?format=xml`, `/api/invoices/${INVOICE_ID}/print`, `/api/zatca/invoice/${INVOICE_ID}/download?format=qr`]));
    expect(all.filter((e) => e.type === CopyButton).map((e) => (e.props as { value: string }).value)).toEqual(["INV-77", "8e6000cf-1a98-4174-b3e7-b5d5954bc10d", "aGFzaA=="]);
    expect(all.find((e) => e.type === ResubmitButton)?.props).toMatchObject({ invoiceId: INVOICE_ID, mode: "resend" });
    const img = all.find((e) => e.type === "img");
    expect((img?.props as { src: string }).src.startsWith("data:image/png;base64,")).toBe(true);
    // ZATCA's error is shown
    expect(JSON.stringify(all.map((e) => (e.props as { children?: unknown }).children ?? null))).toContain("postal code");
  });

  it("404s for another merchant's invoice", async () => {
    h.merchant = { ...h.merchant, id: "00000000-0000-4000-8000-00000000ffff" };
    await expect(InvoiceDetailPage({ params: Promise.resolve({ id: INVOICE_ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/invoices", () => {
  it("filters with a GET form and exports exactly the filtered list", async () => {
    const tree = await InvoicesPage({ searchParams: Promise.resolve({ q: "INV-77", status: "failed" }) });
    const all = elements(tree);
    const form = all.find((e) => e.type === "form");
    expect(form?.props).toMatchObject({ method: "get", action: "/invoices" });
    const inputs = all.filter((e) => e.type === "input" || e.type === "select").map((e) => e.props as { name: string; defaultValue: string });
    expect(inputs).toEqual(expect.arrayContaining([expect.objectContaining({ name: "q", defaultValue: "INV-77" }), expect.objectContaining({ name: "status", defaultValue: "failed" })]));
    const exportLink = all.find((e) => e.type === "a" && String((e.props as { href: string }).href).startsWith("/api/invoices/export"));
    expect((exportLink?.props as { href: string }).href).toBe("/api/invoices/export?q=INV-77&status=failed");
    const query = h.db.calls.find((c) => c.table === "invoices" && c.op === "select");
    expect(query?.filters).toEqual(expect.arrayContaining([["eq", "merchant_id", MERCHANT_ID], ["eq", "status", "failed"]]));
    const hostWithHandlers = all.filter((e) => typeof e.type === "string" && Object.entries(e.props as object).some(([k, v]) => /^on[A-Z]/.test(k) && typeof v === "function"));
    expect(hostWithHandlers).toEqual([]);
  });

  it("ignores an unknown status instead of failing", async () => {
    await InvoicesPage({ searchParams: Promise.resolve({ status: "bogus" }) });
    const query = h.db.calls.find((c) => c.table === "invoices" && c.op === "select");
    expect(query?.filters.some(([, col]) => col === "status")).toBe(false);
  });
});
