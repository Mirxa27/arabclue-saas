/**
 * F14 / UI-024 / SW-2 — GET/POST /api/zatca/onboard against an in-process Fatoora that issues real
 * certificates and re-validates every compliance document (helpers/zatca-fakes.ts):
 *  - the full flow: compliance CSID (OTP) → six compliance checks → production CSID → active;
 *    key + CSIDs stored as enc:v1: ciphertext only, nothing secret in any response;
 *  - gates: unpaid (402), kill switch / not configured (503), incomplete tax profile (409) — no
 *    ZATCA call at all; a refused OTP stores nothing;
 *  - a failed later step is resumed WITHOUT a new OTP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decryptSecret } from "@/lib/crypto/secrets";
import { fakeFatoora, type FakeFatoora } from "../helpers/zatca-fakes";
import { zatcaMemoryDb, type ZatcaMemoryDb } from "../helpers/zatca-db";

const h = vi.hoisted(() => ({
  db: null as unknown as ZatcaMemoryDb,
  merchant: null as unknown as Record<string, unknown>
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.db.client,
  getServiceSupabase: () => h.db.client
}));
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

import { GET, POST } from "@/app/api/zatca/onboard/route";

const MERCHANT_ID = "00000000-0000-4000-8000-00000000e001";
const merchant = (patch: Record<string, unknown> = {}) => ({
  id: MERCHANT_ID,
  owner_user_id: "u-1",
  salla_merchant_id: "store-1",
  salla_store_name: "Oud House",
  plan: "lite",
  subscription_status: "active",
  seller_name: "بيت العود Bait Al Oud",
  vat_number: "399999999900003",
  cr_number: "1010010000",
  seller_address: { street: "King Fahd Rd", building: "1234", district: "Al Olaya", city: "Riyadh", postalCode: "12211" },
  store_url: "https://oud.example",
  zatca_onboarded_at: null,
  ...patch
});

let fatoora: FakeFatoora;

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/zatca/onboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("ZATCA_ENVIRONMENT", "sandbox");
  vi.stubEnv("ZATCA_FATOORA_BASE", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  h.db = zatcaMemoryDb();
  h.merchant = merchant();
  h.db.tables.merchants.push({ ...h.merchant });
  fatoora = fakeFatoora();
  vi.stubGlobal("fetch", fatoora.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/zatca/onboard — the full FATOORA flow", () => {
  it("issues the compliance CSID, passes all six compliance checks and activates the production CSID", async () => {
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.status).toMatchObject({ onboarded: true, step: "active", environment: "sandbox", next: "none", lastError: null });
    expect(body.status.checks.map((c: { status: string }) => c.status)).toEqual(Array(6).fill("passed"));
    expect(fatoora.calls.map((c) => c.path)).toEqual([
      "/compliance",
      ...Array(6).fill("/compliance/invoices"),
      "/production/csids"
    ]);
    expect(fatoora.calls[0].headers.otp).toBe("123345");

    // stored encrypted, never returned
    const [unit] = h.db.tables.zatca_egs_units;
    for (const col of ["private_key_encrypted", "compliance_token_encrypted", "compliance_secret_encrypted", "compliance_request_id_encrypted", "production_token_encrypted", "production_secret_encrypted"]) {
      expect(String(unit[col])).toMatch(/^enc:v1:/);
    }
    expect(decryptSecret(String(unit.private_key_encrypted))).toContain("BEGIN PRIVATE KEY");
    expect(decryptSecret(String(unit.production_secret_encrypted))).toBe("production-secret");
    expect(text).not.toMatch(/PRIVATE KEY|production-secret|compliance-secret|enc:v1:/);
    expect(unit.egs_serial_number).toBe(`1-arabclue|2-salla-v1|3-${MERCHANT_ID}`);
    expect(String(unit.csr_pem)).toContain("BEGIN CERTIFICATE REQUEST");

    // the dashboard flag follows the active unit
    expect(h.db.tables.merchants[0].zatca_onboarded_at).toBe(unit.onboarded_at);
  });

  it("GET shows the non-secret status only", async () => {
    await post({ otp: "123345" });
    const res = await GET();
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.access).toEqual({ ok: true });
    expect(body.status.certificate).toMatchObject({ issuer: "CN=Test eInvoicing CA" });
    expect(body.status.certificate.expiresAt).toBeTruthy();
    expect(text).not.toMatch(/PRIVATE KEY|secret|enc:v1:|BEGIN CERTIFICATE/);
  });

  it("resumes a failed compliance check without a new OTP", async () => {
    let failOnce = true;
    fatoora.respond.set("/compliance/invoices", async (call) => {
      if (failOnce && call.body.invoiceHash) {
        failOnce = false;
        return new Response(
          JSON.stringify({ validationResults: { infoMessages: [], warningMessages: [], errorMessages: [{ code: "BR-KSA-37", category: "KSA", message: "building number" }], status: "ERROR" }, clearanceStatus: "NOT_CLEARED" }),
          { status: 400 }
        );
      }
      fatoora.respond.delete("/compliance/invoices");
      return fatoora.fetch("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance/invoices", {
        method: "POST",
        headers: call.headers,
        body: JSON.stringify(call.body)
      });
    });
    const first = await (await post({ otp: "123345" })).json();
    expect(first.status).toMatchObject({ onboarded: false, step: "compliance_checks", next: "resume" });
    expect(first.status.lastError).toMatchObject({ code: "compliance_check_failed" });
    expect(first.status.checks[0]).toMatchObject({ kind: "standard_invoice", status: "failed", errors: [{ code: "BR-KSA-37" }] });

    const resumed = await (await post({})).json();
    expect(resumed.status).toMatchObject({ onboarded: true, step: "active" });
    expect(fatoora.calls.filter((c) => c.path === "/compliance")).toHaveLength(1); // no second OTP / CSR
  });

  it("an outage at the production step is resumable too", async () => {
    fatoora.respond.set("/production/csids", () => new Response("", { status: 503 }));
    const first = await (await post({ otp: "123345" })).json();
    expect(first.status).toMatchObject({ onboarded: false, step: "production_csid", next: "resume" });
    expect(first.status.lastError).toMatchObject({ code: "zatca_unavailable" });
    fatoora.respond.delete("/production/csids");
    expect((await (await post({})).json()).status).toMatchObject({ onboarded: true });
  });
});

describe("POST /api/zatca/onboard — refusals", () => {
  it("401 without a session", async () => {
    h.merchant = null as unknown as Record<string, unknown>;
    expect((await post({ otp: "123345" })).status).toBe(401);
  });

  it("402 for a merchant without an active subscription (SW-2) — and no ZATCA call", async () => {
    h.merchant = merchant({ subscription_status: "pending" });
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("plan_required");
    expect(fatoora.calls).toHaveLength(0);
  });

  it("503 when the admin kill switch features.zatca is off", async () => {
    h.db.tables.platform_settings.push({ key: "features", value: { zatca: false } });
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("zatca_disabled");
    expect(fatoora.calls).toHaveLength(0);
  });

  it("503 when no ZATCA environment is configured (there is no platform-wide credential)", async () => {
    vi.stubEnv("ZATCA_ENVIRONMENT", "");
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("zatca_not_configured");
    expect(fatoora.calls).toHaveLength(0);
  });

  it("409 until the ZATCA tax details are complete", async () => {
    h.merchant = merchant({ seller_address: { street: "King Fahd Rd", building: "12", city: "Riyadh", postalCode: "12211" } });
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("tax_profile_incomplete");
    expect(body.error).toContain("Building number must be 4 digits");
    expect(body.error).toContain("الحي");
    expect(fatoora.calls).toHaveLength(0);
  });

  it("400 for a missing or refused OTP; nothing is stored", async () => {
    expect((await (await post({})).json()).code).toBe("otp_required");
    const res = await post({ otp: "999999" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_otp");
    expect(h.db.tables.zatca_egs_units).toHaveLength(0);
  });

  it("503 before the OTP is spent when TOKEN_ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    const res = await post({ otp: "123345" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("encryption_not_configured");
    expect(fatoora.calls).toHaveLength(0);
  });

  it("rejects unknown body fields", async () => {
    expect((await post({ otp: "123345", csr: "-----BEGIN CERTIFICATE REQUEST-----" })).status).toBe(400);
  });
});
