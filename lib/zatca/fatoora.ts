/**
 * ZATCA Fatoora client.
 *
 * Two-phase flow:
 *   1. Onboarding — POST /compliance with CSR → receive compliance CSID
 *   2. Production — POST /production/csids with compliance CSID → receive production CSID
 *   3. Per invoice — POST /invoices/clearance (B2B) or POST /invoices/reporting (B2C simplified)
 *
 * Reference: ZATCA E-Invoicing Detailed Guideline & Fatoora Portal API docs.
 *
 * NOTE: Live Fatoora endpoints differ between sandbox (developer-portal) and production.
 * The base URL is configurable via env (ZATCA_FATOORA_BASE).
 */
import { createHash } from "crypto";

export type FatooraConfig = {
  base: string; // e.g., https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal
  csid: string; // Base64-encoded "binarySecurityToken:secret"
};

export type FatooraMessage = {
  code?: string;
  message?: string;
  category?: string;
};

export type FatooraResult = {
  cleared: boolean;
  status: "cleared" | "rejected" | "warning";
  warnings?: FatooraMessage[];
  errors?: FatooraMessage[];
  raw: Record<string, unknown>;
};

// ── Compliance / CSID Onboarding ──────────────────────────────────────────
export async function requestComplianceCSID(opts: {
  base: string;
  csr: string; // PEM-encoded CSR
  otp: string; // ZATCA-issued OTP
}): Promise<{ binarySecurityToken: string; secret: string; requestID: string }> {
  const res = await fetch(`${opts.base}/compliance`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-version": "V2",
      otp: opts.otp,
      "content-type": "application/json"
    },
    body: JSON.stringify({ csr: Buffer.from(opts.csr, "utf8").toString("base64") })
  });
  if (!res.ok) throw new Error(`ZATCA compliance request failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

export async function requestProductionCSID(opts: {
  base: string;
  complianceCSID: string; // Base64(binarySecurityToken:secret)
  complianceRequestID: string;
}): Promise<{ binarySecurityToken: string; secret: string }> {
  const res = await fetch(`${opts.base}/production/csids`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-version": "V2",
      authorization: `Basic ${opts.complianceCSID}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ compliance_request_id: opts.complianceRequestID })
  });
  if (!res.ok) throw new Error(`ZATCA production CSID failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// ── Invoice submission ────────────────────────────────────────────────────
type SubmitArgs = {
  xml: string;
  uuid: string;
  invoiceHash: string;
  csid?: string;
  base?: string;
  /** true = B2B clearance (synchronous), false = B2C reporting (within 24h) */
  isB2B?: boolean;
};

export async function submitToFatoora(args: SubmitArgs): Promise<FatooraResult> {
  if (!args.csid) throw new Error("Missing CSID. Onboard the merchant before submitting invoices.");
  if (!args.base) throw new Error("Missing ZATCA_FATOORA_BASE.");

  const endpoint = args.isB2B ? "/invoices/clearance/single" : "/invoices/reporting/single";

  const res = await fetch(`${args.base}${endpoint}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "accept-version": "V2",
      authorization: `Basic ${args.csid}`,
      "clearance-status": args.isB2B ? "1" : "0",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      invoiceHash: args.invoiceHash,
      uuid: args.uuid,
      invoice: Buffer.from(args.xml, "utf8").toString("base64")
    })
  });

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const validation = raw.validationResults as
    | { warningMessages?: FatooraMessage[]; errorMessages?: FatooraMessage[] }
    | undefined;
  const warnings = validation?.warningMessages;
  const cleared =
    res.ok && (raw.clearanceStatus === "CLEARED" || raw.reportingStatus === "REPORTED");

  return {
    cleared,
    status: cleared ? "cleared" : warnings?.length ? "warning" : "rejected",
    warnings,
    errors: validation?.errorMessages,
    raw
  };
}

// ── Hash helpers ──────────────────────────────────────────────────────────
export function sha256Base64(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("base64");
}
