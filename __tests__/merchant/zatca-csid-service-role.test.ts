/**
 * RA-9 (b) — the ZATCA production CSID is a credential: authenticated can no longer SELECT
 * merchants.zatca_csid, so the session's merchant (getCurrentMerchant) does not carry it.
 * POST /api/zatca/invoice/[id] must read the CSID of *this* merchant with the service role —
 * otherwise it silently submits with the platform's ZATCA_CSID (or none).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  csid: "MERCHANT-CSID" as string | null,
  submit: vi.fn()
}));

const MERCHANT_ID = "00000000-0000-4000-8000-0000000009a2";

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUserApi: vi.fn(async () => ({ id: "u-1" })),
  // what getCurrentMerchant returns now: the client columns only, no zatca_csid
  getCurrentMerchant: vi.fn(async () => ({ id: MERCHANT_ID, seller_name: "Store", plan: "plus", zatca_onboarded_at: "2026-11-01T00:00:00Z" }))
}));
vi.mock("@/lib/zatca/fatoora", () => ({ submitToFatoora: h.submit }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { POST } from "@/app/api/zatca/invoice/[id]/route";

const invoice = { id: "inv-1", merchant_id: MERCHANT_ID, xml: "<Invoice/>", uuid: "u-u-i-d", invoice_hash: "hash" };

beforeEach(() => {
  vi.stubEnv("ZATCA_CSID", "PLATFORM-CSID");
  vi.stubEnv("ZATCA_FATOORA_BASE", "https://fatoora.example");
  h.csid = "MERCHANT-CSID";
  h.submit.mockReset();
  h.submit.mockResolvedValue({ cleared: true, raw: { ok: true } });
  h.user = createFakeSupabase("user", (call: FakeCall) => (call.table === "invoices" ? { data: invoice } : undefined));
  h.service = createFakeSupabase("service", (call: FakeCall) =>
    call.table === "merchants" && call.op === "select" ? { data: { zatca_csid: h.csid } } : { data: null }
  );
});
afterEach(() => vi.unstubAllEnvs());

const post = () =>
  POST(new NextRequest(`http://localhost/api/zatca/invoice/${invoice.id}`, { method: "POST" }), {
    params: Promise.resolve({ id: invoice.id })
  });

describe("POST /api/zatca/invoice/[id]", () => {
  it("submits with the merchant's own CSID, read on the service role by merchant id", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ csid: "MERCHANT-CSID", uuid: invoice.uuid }));
    const lookup = h.service.calls.find((c) => c.table === "merchants")!;
    expect(lookup.columns).toBe("zatca_csid");
    expect(lookup.filters).toEqual([["eq", "id", MERCHANT_ID]]);
    // the user session never asks for the credential
    expect(h.user.calls.some((c) => c.table === "merchants")).toBe(false);
  });

  it("keeps the documented fallback to the platform CSID only when the merchant has none", async () => {
    h.csid = null;
    await post();
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ csid: "PLATFORM-CSID" }));
  });

  it("fails with a 500 (not a submission without credentials) when the CSID lookup fails", async () => {
    h.service = createFakeSupabase("service", (call: FakeCall) =>
      call.table === "merchants" ? { error: { code: "57014", message: "statement timeout" } } : { data: null }
    );
    const res = await post();
    expect(res.status).toBe(500);
    expect(h.submit).not.toHaveBeenCalled();
  });
});
