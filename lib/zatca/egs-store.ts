/**
 * Service-role storage of a merchant's ZATCA EGS unit (public.zatca_egs_units, 20261106003500).
 *
 * The private key and both CSIDs (token, secret, compliance request id) are stored only as enc:v1:
 * ciphertext (encryptSecretStrict — TOKEN_ENCRYPTION_KEY is mandatory; the table's CHECK constraints
 * refuse anything else). Nothing in this module returns key material to a caller that could pass it
 * to the browser: routes get `publicEgsStatus()`, the signer gets `signingMaterial()`.
 */
import type { KeyObject } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { decryptSecretStrict, encryptSecretStrict } from "@/lib/crypto/secrets";
import { certificateFromSecurityToken, type EgsCertificate } from "@/lib/zatca/certificate";
import { loadEgsPrivateKey } from "@/lib/zatca/csr";
import type { ZatcaConfig, ZatcaEnvironment } from "@/lib/zatca/config";
import type { FatooraMessage } from "@/lib/zatca/fatoora";

export type EgsStatus = "compliance_issued" | "compliance_passed" | "active";

/** The six compliance documents (standard / simplified × invoice / credit note / debit note). */
export type ComplianceCheckKind =
  | "standard_invoice"
  | "standard_credit_note"
  | "standard_debit_note"
  | "simplified_invoice"
  | "simplified_credit_note"
  | "simplified_debit_note";

export type ComplianceCheckRecord = {
  passed: boolean;
  at: string;
  warnings: FatooraMessage[];
  errors: FatooraMessage[];
};

export type EgsError = { code: string; message: string; details?: FatooraMessage[]; at: string; step?: string };

export type EgsRow = {
  merchant_id: string;
  environment: ZatcaEnvironment;
  status: EgsStatus;
  common_name: string;
  egs_serial_number: string;
  invoice_types: string;
  csr_pem: string;
  private_key_encrypted: string;
  compliance_token_encrypted: string | null;
  compliance_secret_encrypted: string | null;
  compliance_request_id_encrypted: string | null;
  compliance_checks: Partial<Record<ComplianceCheckKind, ComplianceCheckRecord>>;
  production_token_encrypted: string | null;
  production_secret_encrypted: string | null;
  certificate_serial: string | null;
  certificate_issuer: string | null;
  certificate_not_after: string | null;
  last_error: EgsError | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "zatca_egs_units";

export async function loadEgsRow(sb: SupabaseClient, merchantId: string): Promise<EgsRow | null> {
  const { data, error } = await sb.from(TABLE).select("*").eq("merchant_id", merchantId).maybeSingle();
  if (error) throw new Error(`zatca_egs_units lookup failed: ${error.message}`);
  return (data as EgsRow | null) ?? null;
}

export type NewEgsUnit = {
  environment: ZatcaEnvironment;
  commonName: string;
  egsSerialNumber: string;
  invoiceTypes: string;
  csrPem: string;
  privateKeyPem: string;
  compliance: { token: string; secret: string; requestId: string };
};

/** A fresh EGS unit with its compliance CSID (replaces any previous unit of the merchant). */
export async function saveNewEgsUnit(sb: SupabaseClient, merchantId: string, unit: NewEgsUnit): Promise<EgsRow> {
  const row = {
    merchant_id: merchantId,
    environment: unit.environment,
    status: "compliance_issued" as const,
    common_name: unit.commonName,
    egs_serial_number: unit.egsSerialNumber,
    invoice_types: unit.invoiceTypes,
    csr_pem: unit.csrPem,
    private_key_encrypted: encryptSecretStrict(unit.privateKeyPem),
    compliance_token_encrypted: encryptSecretStrict(unit.compliance.token),
    compliance_secret_encrypted: encryptSecretStrict(unit.compliance.secret),
    compliance_request_id_encrypted: encryptSecretStrict(unit.compliance.requestId),
    compliance_checks: {},
    production_token_encrypted: null,
    production_secret_encrypted: null,
    certificate_serial: null,
    certificate_issuer: null,
    certificate_not_after: null,
    last_error: null,
    onboarded_at: null
  };
  const { data, error } = await sb.from(TABLE).upsert(row, { onConflict: "merchant_id" }).select("*").single();
  if (error) throw new Error(`saving the ZATCA EGS unit failed: ${error.message}`);
  return data as EgsRow;
}

/**
 * Update the merchant's unit. `csrGuard` pins the update to the unit a step started with: when a
 * concurrent restart replaced it (new key, new CSR), the stale step must not write into the new one.
 */
export async function updateEgsUnit(sb: SupabaseClient, merchantId: string, patch: Partial<EgsRow>, csrGuard?: string): Promise<EgsRow> {
  let query = sb.from(TABLE).update(patch).eq("merchant_id", merchantId);
  if (csrGuard) query = query.eq("csr_pem", csrGuard);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`updating the ZATCA EGS unit failed: ${error.message}`);
  if (!data) {
    throw new HttpError(409, "ZATCA onboarding was restarted in another request. Reload and try again. / بدأ تسجيل آخر في طلب آخر.", "onboarding_restarted");
  }
  return data as EgsRow;
}

export function encryptedProductionCsid(csid: { token: string; secret: string }) {
  return {
    production_token_encrypted: encryptSecretStrict(csid.token),
    production_secret_encrypted: encryptSecretStrict(csid.secret)
  };
}

export type SigningMaterial = {
  privateKey: KeyObject;
  certificate: EgsCertificate;
  credential: { token: string; secret: string };
};

export function complianceMaterial(row: EgsRow): SigningMaterial & { requestId: string } {
  if (!row.compliance_token_encrypted || !row.compliance_secret_encrypted || !row.compliance_request_id_encrypted) {
    throw new Error("the EGS unit has no compliance CSID");
  }
  const token = decryptSecretStrict(row.compliance_token_encrypted);
  return {
    privateKey: loadEgsPrivateKey(decryptSecretStrict(row.private_key_encrypted)),
    certificate: certificateFromSecurityToken(token),
    credential: { token, secret: decryptSecretStrict(row.compliance_secret_encrypted) },
    requestId: decryptSecretStrict(row.compliance_request_id_encrypted)
  };
}

/** The production credential for signing and submitting invoices (active units only). */
export function signingMaterial(row: EgsRow): SigningMaterial {
  if (row.status !== "active" || !row.production_token_encrypted || !row.production_secret_encrypted) {
    throw new Error("the EGS unit is not active");
  }
  const token = decryptSecretStrict(row.production_token_encrypted);
  return {
    privateKey: loadEgsPrivateKey(decryptSecretStrict(row.private_key_encrypted)),
    certificate: certificateFromSecurityToken(token),
    credential: { token, secret: decryptSecretStrict(row.production_secret_encrypted) }
  };
}

/** Active and onboarded for the environment this deployment talks to. */
export function isEgsActiveFor(row: EgsRow | null, cfg: ZatcaConfig | null): row is EgsRow {
  return Boolean(row && cfg && row.status === "active" && row.environment === cfg.environment);
}

export function requiredComplianceChecks(invoiceTypes: string): ComplianceCheckKind[] {
  const kinds: ComplianceCheckKind[] = [];
  if (invoiceTypes[0] === "1") kinds.push("standard_invoice", "standard_credit_note", "standard_debit_note");
  if (invoiceTypes[1] === "1") kinds.push("simplified_invoice", "simplified_credit_note", "simplified_debit_note");
  return kinds;
}

// ── what the dashboard may see ─────────────────────────────────────────────

export type OnboardingStep = "not_started" | "compliance_csid" | "compliance_checks" | "production_csid" | "active";

export type EgsPublicStatus = {
  configured: boolean;
  environment: ZatcaEnvironment | null;
  /** The unit belongs to another environment than the deployment's (re-onboarding needed). */
  environmentMismatch: boolean;
  onboarded: boolean;
  step: OnboardingStep;
  /** The next action: start (needs an OTP), resume (no OTP), or none. */
  next: "start" | "resume" | "none";
  egsSerialNumber: string | null;
  certificate: { serialNumber: string | null; issuer: string | null; expiresAt: string | null } | null;
  checks: Array<{ kind: ComplianceCheckKind; status: "passed" | "failed" | "pending"; warnings: FatooraMessage[]; errors: FatooraMessage[] }>;
  lastError: EgsError | null;
  onboardedAt: string | null;
};

export function publicEgsStatus(row: EgsRow | null, cfg: ZatcaConfig | null): EgsPublicStatus {
  const environmentMismatch = Boolean(row && cfg && row.environment !== cfg.environment);
  const usable = row && !environmentMismatch ? row : null;
  const step: OnboardingStep = !usable
    ? "not_started"
    : usable.status === "active"
      ? "active"
      : usable.status === "compliance_passed"
        ? "production_csid"
        : "compliance_checks";
  const kinds = usable ? requiredComplianceChecks(usable.invoice_types) : [];
  return {
    configured: Boolean(cfg),
    environment: cfg?.environment ?? null,
    environmentMismatch,
    onboarded: step === "active",
    step,
    next: !cfg ? "none" : step === "not_started" ? "start" : step === "active" ? "none" : "resume",
    egsSerialNumber: usable?.egs_serial_number ?? null,
    certificate: usable?.status === "active"
      ? { serialNumber: usable.certificate_serial, issuer: usable.certificate_issuer, expiresAt: usable.certificate_not_after }
      : null,
    checks: kinds.map((kind) => {
      const rec = usable?.compliance_checks?.[kind];
      return { kind, status: !rec ? "pending" : rec.passed ? "passed" : "failed", warnings: rec?.warnings ?? [], errors: rec?.errors ?? [] };
    }),
    lastError: usable?.last_error ?? null,
    onboardedAt: usable?.onboarded_at ?? null
  };
}
