/**
 * RA-9 (b), updated for F14 — ZATCA credentials are server-side only. The session's merchant
 * (getCurrentMerchant) carries no credential; POST /api/zatca/invoice/[id] loads THIS merchant's EGS
 * unit (zatca_egs_units: key + production CSID, encrypted) with the service role, by merchant id.
 * There is no platform-wide fallback any more: ZATCA_CSID is ignored and a merchant without an
 * active unit gets 409 "onboard first" (F14), instead of submitting under another taxpayer's CSID.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  fetch: null as unknown as ReturnType<typeof import("vitest").vi.fn>
}));

const MERCHANT_ID = "00000000-0000-4000-8000-0000000009a2";
const INVOICE_ID = "00000000-0000-4000-8000-0000000009b1";

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  // what getCurrentMerchant returns: the client columns only, no credential
  requireMerchantApi: vi.fn(async () => ({
    id: MERCHANT_ID,
    seller_name: "Store",
    vat_number: "399999999900003",
    cr_number: null,
    seller_address: { street: "King Fahd Rd", building: "1234", district: "Al Olaya", city: "Riyadh", postalCode: "12211" },
    plan: "lite",
    subscription_status: "active",
    salla_merchant_id: null,
    zatca_onboarded_at: "2026-11-01T00:00:00Z"
  }))
}));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => null)
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { POST } from "@/app/api/zatca/invoice/[id]/route";

const invoice = { id: INVOICE_ID, merchant_id: MERCHANT_ID, xml: "<Invoice/>", uuid: "u-u-i-d", invoice_hash: "hash", status: "failed", invoice_type: "simplified", environment: "sandbox", invoice_number: "INV-1" };

let egsLookup: (call: FakeCall) => { data?: unknown; error?: { code?: string; message?: string } };

beforeEach(() => {
  vi.stubEnv("ZATCA_ENVIRONMENT", "sandbox");
  vi.stubEnv("ZATCA_CSID", "PLATFORM-CSID");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  h.fetch = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", h.fetch);
  egsLookup = () => ({ data: null });
  h.user = createFakeSupabase("user");
  h.service = createFakeSupabase("service", (call: FakeCall) => {
    if (call.table === "invoices" && call.op === "select") return { data: invoice };
    if (call.table === "zatca_egs_units") return egsLookup(call);
    if (call.table === "platform_settings") return { data: null };
    return { data: null };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = () => POST(new NextRequest(`http://localhost/api/zatca/invoice/${INVOICE_ID}`, { method: "POST" }), { params: Promise.resolve({ id: INVOICE_ID }) });

describe("POST /api/zatca/invoice/[id] — credentials", () => {
  it("reads this merchant's EGS unit on the service role, by merchant id — the session never asks for credentials", async () => {
    await post();
    const lookup = h.service.calls.find((c) => c.table === "zatca_egs_units");
    expect(lookup?.filters).toEqual([["eq", "merchant_id", MERCHANT_ID]]);
    expect(h.user.calls.some((c) => c.table === "merchants" || c.table === "zatca_egs_units")).toBe(false);
    expect(h.service.calls.some((c) => c.table === "merchants" && String(c.columns).includes("zatca_csid"))).toBe(false);
  });

  it("has no platform-wide fallback: without an EGS unit it is 409 'onboard first', and nothing is submitted", async () => {
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "onboard_first" });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("fails with a 500 (not a submission without credentials) when the credential lookup fails", async () => {
    egsLookup = () => ({ error: { code: "57014", message: "statement timeout" } });
    const res = await post();
    expect(res.status).toBe(500);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
