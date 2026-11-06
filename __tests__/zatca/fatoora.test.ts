/**
 * lib/zatca/fatoora.ts — request shape (V2 headers, Basic credential, OTP, base64 bodies) and the
 * mapping of Fatoora's answers (recorded from the developer-portal sandbox, zatca-phase2.md §API):
 * validation outcomes are results; 401 / 429 / 5xx / network errors throw FatooraError.
 */
import { describe, expect, it, vi } from "vitest";
import {
  clearDocument,
  FatooraError,
  reportDocument,
  requestComplianceCsid,
  requestProductionCsid,
  submitComplianceDocument
} from "@/lib/zatca/fatoora";
import { basicCredential } from "@/lib/zatca/certificate";

const cfg = { environment: "sandbox" as const, baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal" };
const cred = { token: "VE9LRU4=", secret: "s3cr3t" };
const doc = { invoiceHash: "aGFzaA==", uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d", xml: "<Invoice>محمد</Invoice>" };

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}
const sent = (f: ReturnType<typeof vi.fn>) => {
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
};
const pass = (extra: Record<string, unknown>) => ({
  validationResults: { infoMessages: [{ code: "XSD_ZATCA_VALID" }], warningMessages: [], errorMessages: [], status: "PASS" },
  ...extra
});

describe("onboarding calls", () => {
  it("POST /compliance sends the OTP header and base64(CSR PEM)", async () => {
    const f = fetchReturning(200, { requestID: 1234567890123, dispositionMessage: "ISSUED", binarySecurityToken: "TUlJ", secret: "x", errors: null });
    const csid = await requestComplianceCsid(cfg, { csrBase64: "LS0tLS1CRUdJTg==", otp: "123345" }, { fetch: f });
    expect(csid).toEqual({ binarySecurityToken: "TUlJ", secret: "x", requestId: "1234567890123", dispositionMessage: "ISSUED" });
    const s = sent(f);
    expect(s.url).toBe(`${cfg.baseUrl}/compliance`);
    expect(s.headers).toMatchObject({ otp: "123345", "accept-version": "V2", "content-type": "application/json" });
    expect(s.body).toEqual({ csr: "LS0tLS1CRUdJTg==" });
  });

  it("maps a refused OTP and an unreadable CSR", async () => {
    await expect(
      requestComplianceCsid(cfg, { csrBase64: "x", otp: "1" }, { fetch: fetchReturning(400, { errors: [{ code: "Invalid-OTP", message: "The provided OTP is invalid" }] }) })
    ).rejects.toMatchObject({ kind: "invalid_otp", httpStatus: 400, errors: [{ code: "Invalid-OTP" }] });
    await expect(requestComplianceCsid(cfg, { csrBase64: "x", otp: "123345" }, { fetch: fetchReturning(400, "Invalid Request") })).rejects.toMatchObject({
      kind: "invalid_request",
      errors: [{ message: "Invalid Request" }]
    });
  });

  it("POST /production/csids authenticates with the compliance CSID", async () => {
    const f = fetchReturning(200, { requestID: 30368, dispositionMessage: "ISSUED", binarySecurityToken: "UFJPRA==", secret: "p" });
    await requestProductionCsid(cfg, { complianceToken: cred.token, complianceSecret: cred.secret, complianceRequestId: "1234567890123" }, { fetch: f });
    const s = sent(f);
    expect(s.headers.authorization).toBe(`Basic ${basicCredential(cred.token, cred.secret)}`);
    expect(Buffer.from(basicCredential(cred.token, cred.secret), "base64").toString()).toBe("VE9LRU4=:s3cr3t");
    expect(s.body).toEqual({ compliance_request_id: "1234567890123" });
    await expect(
      requestProductionCsid(cfg, { complianceToken: "a", complianceSecret: "b", complianceRequestId: "9" }, { fetch: fetchReturning(400, { code: "Incorrect-ComplianceRequestId", message: "must be 13 digits" }) })
    ).rejects.toMatchObject({ kind: "invalid_request", errors: [{ code: "Incorrect-ComplianceRequestId" }] });
  });
});

describe("document submission", () => {
  it("reporting: base64 XML body, clearance-status 0, REPORTED → accepted", async () => {
    const f = fetchReturning(200, pass({ reportingStatus: "REPORTED" }));
    const r = await reportDocument(cfg, cred, doc, { fetch: f });
    expect(r).toMatchObject({ outcome: "accepted", httpStatus: 200, reportingStatus: "REPORTED", errors: [], warnings: [] });
    const s = sent(f);
    expect(s.url).toBe(`${cfg.baseUrl}/invoices/reporting/single`);
    expect(s.headers["clearance-status"]).toBe("0");
    expect(s.headers["accept-language"]).toBe("en");
    expect(Buffer.from(s.body.invoice, "base64").toString()).toBe(doc.xml);
    expect(s.body).toMatchObject({ invoiceHash: doc.invoiceHash, uuid: doc.uuid });
  });

  it("clearance: CLEARED with ZATCA's stamped XML decoded, kept out of the stored response", async () => {
    const cleared = Buffer.from("<Invoice>cleared</Invoice>").toString("base64");
    const f = fetchReturning(200, pass({ clearanceStatus: "CLEARED", clearedInvoice: cleared }));
    const r = await clearDocument(cfg, cred, doc, { fetch: f });
    expect(r).toMatchObject({ outcome: "accepted", clearanceStatus: "CLEARED", clearedXml: "<Invoice>cleared</Invoice>" });
    expect(JSON.stringify(r.raw)).not.toContain(cleared);
    expect(sent(f).headers["clearance-status"]).toBe("1");
  });

  it("202 with warnings is accepted with warnings; 400 with errors is a rejection (not an exception)", async () => {
    const warn = { validationResults: { infoMessages: [], warningMessages: [{ code: "BR-KSA-08", message: "seller id" }], errorMessages: [], status: "WARNING" }, reportingStatus: "REPORTED" };
    expect(await reportDocument(cfg, cred, doc, { fetch: fetchReturning(202, warn) })).toMatchObject({ outcome: "accepted_with_warnings", warnings: [{ code: "BR-KSA-08" }] });
    const err = {
      validationResults: { infoMessages: [], warningMessages: [], errorMessages: [{ type: "ERROR", code: "certificate-permissions", category: "CERTIFICATE_ERRORS", message: "User only allowed to use the vat number that exists in the authentication certificate" }], status: "ERROR" },
      reportingStatus: "NOT_REPORTED"
    };
    expect(await reportDocument(cfg, cred, doc, { fetch: fetchReturning(400, err) })).toMatchObject({ outcome: "rejected", errors: [{ code: "certificate-permissions" }] });
  });

  it("303 means clearance is switched off (report instead)", async () => {
    expect(await clearDocument(cfg, cred, doc, { fetch: fetchReturning(303, "") })).toMatchObject({ outcome: "clearance_disabled" });
  });

  it("throws FatooraError for 401, 429, 5xx and network failures", async () => {
    await expect(reportDocument(cfg, cred, doc, { fetch: fetchReturning(401, "") })).rejects.toMatchObject({ kind: "unauthorized", transient: false });
    await expect(reportDocument(cfg, cred, doc, { fetch: fetchReturning(429, "") })).rejects.toMatchObject({ kind: "rate_limited", transient: true });
    await expect(reportDocument(cfg, cred, doc, { fetch: fetchReturning(502, "") })).rejects.toMatchObject({ kind: "unavailable", transient: true });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await reportDocument(cfg, cred, doc, { fetch: down as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(FatooraError);
    expect(err.transient).toBe(true);
  });

  it("compliance checks use the same submission shape", async () => {
    const f = fetchReturning(200, pass({ reportingStatus: "REPORTED" }));
    expect(await submitComplianceDocument(cfg, cred, doc, { fetch: f })).toMatchObject({ outcome: "accepted" });
    expect(sent(f).url).toBe(`${cfg.baseUrl}/compliance/invoices`);
  });
});
