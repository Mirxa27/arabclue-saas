/**
 * ZATCA EGS onboarding for one merchant (F14 / UI-024) — the FATOORA flow of the E-invoicing
 * Detailed Technical Guideline §3 and the Developer Portal manual §2.3.10:
 *
 *   1. compliance CSID   new secp256k1 key + CSR (lib/zatca/csr.ts) → POST /compliance with the
 *                        merchant's one-time password; key and CSID stored encrypted
 *   2. compliance checks one signed sample of every document type the CSR declares (standard and
 *                        simplified × invoice / credit note / debit note) → POST /compliance/invoices
 *   3. production CSID   POST /production/csids with the compliance request id
 *
 * Every step persists its result, so a failure after step 1 is resumed without a new OTP (OTPs are
 * single use and expire after an hour). The private key never leaves the server.
 */
import { createPublicKey, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { hasEncryptionKey } from "@/lib/crypto/secrets";
import { toAsciiDigits } from "@/lib/i18n/digits";
import type { MerchantRow } from "@/lib/types/database";
import type { ZatcaConfig } from "@/lib/zatca/config";
import { buildEgsCsr, CsrInputError, generateEgsKeyPair, type EgsCsrInput } from "@/lib/zatca/csr";
import { certificateFromSecurityToken } from "@/lib/zatca/certificate";
import {
  FatooraError,
  requestComplianceCsid,
  requestProductionCsid,
  submitComplianceDocument,
  type FatooraClientOptions,
  type FatooraMessage
} from "@/lib/zatca/fatoora";
import {
  complianceMaterial,
  encryptedProductionCsid,
  loadEgsRow,
  publicEgsStatus,
  requiredComplianceChecks,
  saveNewEgsUnit,
  updateEgsUnit,
  type ComplianceCheckKind,
  type ComplianceCheckRecord,
  type EgsError,
  type EgsPublicStatus,
  type EgsRow
} from "@/lib/zatca/egs-store";
import { buildUnsignedDocument, GENESIS_PREVIOUS_INVOICE_HASH, type BuyerInfo } from "@/lib/zatca/invoice";
import { signDocument } from "@/lib/zatca/signing";
import { describeTaxProfileProblems, sellerFromMerchant, taxProfileProblems } from "@/lib/zatca/seller";

/** Solution identity in the EGS serial number ("1-<provider>|2-<model/version>|3-<serial>"). */
export const EGS_PROVIDER = "arabclue";
export const EGS_MODEL = "salla-v1";
/** Functionality map: standard (B2B) and simplified (B2C) documents. */
export const EGS_INVOICE_TYPES = "1100";

export type OnboardingMerchant = Pick<
  MerchantRow,
  "id" | "seller_name" | "vat_number" | "cr_number" | "seller_address" | "store_url" | "salla_store_name"
>;

export type OnboardingOptions = {
  /** FATOORA portal one-time password — needed to start (or restart) onboarding. */
  otp?: string | null;
  /** Replace an active EGS unit (e.g. certificate expiring or revoked). */
  restart?: boolean;
  branchName?: string | null;
  industry?: string | null;
  /** VAT groups (11th VAT digit 1): the member's 10-digit TIN goes into the CSR's OU. */
  groupMemberTin?: string | null;
};

type Deps = { fetch?: FatooraClientOptions["fetch"]; now?: () => Date };

const COMPLIANCE_BUYER: BuyerInfo = {
  name: "Compliance check buyer / مشتري اختبار الامتثال",
  vatNumber: "399999999800003",
  address: { street: "King Fahd Road", building: "1111", district: "Al Olaya", city: "Riyadh", postalCode: "12222", countryCode: "SA" }
};

const ZATCA_STEP_MESSAGES = {
  invalid_otp: "ZATCA did not accept the one-time password. Generate a new OTP in the FATOORA portal and try again. / لم تقبل زاتكا رمز التحقق. أنشئ رمزاً جديداً من بوابة فاتورة وحاول مرة أخرى.",
  unavailable: "ZATCA could not be reached. Try again in a few minutes. / تعذر الوصول إلى زاتكا. حاول مرة أخرى بعد دقائق.",
  rejected: "ZATCA refused the onboarding request. / رفضت زاتكا طلب التسجيل.",
  bad_certificate: "ZATCA returned a certificate that does not belong to this device's key. / أعادت زاتكا شهادة لا تخص مفتاح هذا الجهاز."
} as const;

function describe(messages: FatooraMessage[]): string {
  return messages
    .map((m) => [m.code, m.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .slice(0, 5)
    .join("; ");
}

function errorFrom(err: FatooraError, step: string, now: Date): EgsError {
  const code = err.transient ? "zatca_unavailable" : err.kind === "unauthorized" ? "zatca_unauthorized" : "zatca_rejected";
  const base = err.transient ? ZATCA_STEP_MESSAGES.unavailable : ZATCA_STEP_MESSAGES.rejected;
  const detail = describe(err.errors);
  return { code, message: detail ? `${base} ${detail}` : base, details: err.errors, at: now.toISOString(), step };
}

export function egsCsrInputFor(merchant: OnboardingMerchant, cfg: ZatcaConfig, opts: OnboardingOptions): EgsCsrInput {
  const seller = sellerFromMerchant(merchant);
  const vat = seller.vatNumber;
  const short = (v: string, max: number) => [...v.trim()].slice(0, max).join("");
  const isGroup = vat[10] === "1";
  const tin = toAsciiDigits(opts.groupMemberTin ?? "").trim();
  if (isGroup && !/^\d{10}$/.test(tin)) {
    throw new HttpError(
      400,
      "This is a VAT group number: enter the 10-digit TIN of the group member being onboarded. / هذا رقم مجموعة ضريبية: أدخل الرقم المميز (10 أرقام) لعضو المجموعة.",
      "group_member_tin_required"
    );
  }
  const a = seller.address;
  return {
    environment: cfg.environment,
    commonName: `${EGS_PROVIDER}-${merchant.id}`,
    organizationName: short(seller.name, 64),
    organizationUnit: isGroup ? tin : short(opts.branchName?.trim() || merchant.salla_store_name?.trim() || "Main Branch", 64),
    egsSerialNumber: `1-${EGS_PROVIDER}|2-${EGS_MODEL}|3-${merchant.id}`,
    vatNumber: vat,
    invoiceTypes: EGS_INVOICE_TYPES,
    location: short(`${a.building} ${a.street}, ${a.district}, ${a.city} ${a.postalCode}`, 200),
    industry: short(opts.industry?.trim() || "E-commerce", 100)
  };
}

async function issueComplianceCsid(
  sb: SupabaseClient,
  merchant: OnboardingMerchant,
  cfg: ZatcaConfig,
  opts: OnboardingOptions,
  deps: Deps
): Promise<EgsRow> {
  // The key and CSIDs are stored encrypted only: refuse before the single-use OTP is spent.
  if (!hasEncryptionKey()) {
    throw new HttpError(503, "ZATCA onboarding is unavailable: the platform's encryption key is not configured. / التسجيل غير متاح حالياً.", "encryption_not_configured");
  }
  const otp = toAsciiDigits(opts.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new HttpError(400, "Enter the 6-digit one-time password from the FATOORA portal. / أدخل رمز التحقق المكوّن من 6 أرقام من بوابة فاتورة.", "otp_required");
  }
  const input = egsCsrInputFor(merchant, cfg, opts);
  const keys = generateEgsKeyPair();
  let csr;
  try {
    csr = buildEgsCsr(input, keys.privateKey);
  } catch (err) {
    if (err instanceof CsrInputError) throw new HttpError(400, `Invalid ZATCA device details: ${err.problems.join("; ")}`, "invalid_csr_input");
    throw err;
  }
  let csid;
  try {
    csid = await requestComplianceCsid(cfg, { csrBase64: csr.base64Pem, otp }, { fetch: deps.fetch });
  } catch (err) {
    if (!(err instanceof FatooraError)) throw err;
    if (err.kind === "invalid_otp") throw new HttpError(400, ZATCA_STEP_MESSAGES.invalid_otp, "invalid_otp");
    if (err.transient) throw new HttpError(503, ZATCA_STEP_MESSAGES.unavailable, "zatca_unavailable");
    const detail = describe(err.errors);
    throw new HttpError(422, detail ? `${ZATCA_STEP_MESSAGES.rejected} ${detail}` : ZATCA_STEP_MESSAGES.rejected, "zatca_rejected");
  }
  const certificate = certificateFromSecurityToken(csid.binarySecurityToken);
  if (!certificate.publicKey.equals(keys.publicKeySpki)) {
    throw new HttpError(502, ZATCA_STEP_MESSAGES.bad_certificate, "certificate_key_mismatch");
  }
  if (!csid.requestId) throw new HttpError(502, "ZATCA did not return a compliance request id.", "zatca_bad_response");
  return saveNewEgsUnit(sb, merchant.id, {
    environment: cfg.environment,
    commonName: input.commonName,
    egsSerialNumber: input.egsSerialNumber,
    invoiceTypes: input.invoiceTypes,
    csrPem: csr.pem,
    privateKeyPem: keys.privateKeyPem,
    compliance: { token: csid.binarySecurityToken, secret: csid.secret, requestId: csid.requestId }
  });
}

const KIND_SHAPE: Record<ComplianceCheckKind, { invoiceType: "standard" | "simplified"; documentType: "invoice" | "credit_note" | "debit_note" }> = {
  standard_invoice: { invoiceType: "standard", documentType: "invoice" },
  standard_credit_note: { invoiceType: "standard", documentType: "credit_note" },
  standard_debit_note: { invoiceType: "standard", documentType: "debit_note" },
  simplified_invoice: { invoiceType: "simplified", documentType: "invoice" },
  simplified_credit_note: { invoiceType: "simplified", documentType: "credit_note" },
  simplified_debit_note: { invoiceType: "simplified", documentType: "debit_note" }
};

async function runComplianceChecks(sb: SupabaseClient, merchant: OnboardingMerchant, cfg: ZatcaConfig, row: EgsRow, deps: Deps): Promise<EgsRow> {
  const now = deps.now ?? (() => new Date());
  const material = complianceMaterial(row);
  const seller = sellerFromMerchant(merchant);
  const kinds = requiredComplianceChecks(row.invoice_types);
  const checks: Partial<Record<ComplianceCheckKind, ComplianceCheckRecord>> = { ...(row.compliance_checks ?? {}) };
  let previousHash = GENESIS_PREVIOUS_INVOICE_HASH;
  let current = row;

  for (const [index, kind] of kinds.entries()) {
    if (checks[kind]?.passed) continue;
    const shape = KIND_SHAPE[kind];
    const issuedAt = now();
    const unsigned = buildUnsignedDocument({
      ...shape,
      invoiceNumber: `CMP-${index + 1}`,
      uuid: randomUUID(),
      issuedAt,
      icv: index + 1,
      previousInvoiceHash: previousHash,
      seller,
      buyer: shape.invoiceType === "standard" ? COMPLIANCE_BUYER : { name: "Walk-in customer / عميل نقدي" },
      lines: [{ name: "Compliance check item / بند اختبار الامتثال", quantity: 1, unitPrice: 100, vatRate: 0.15 }],
      billingReference: shape.documentType === "invoice" ? undefined : "CMP-1",
      reason: shape.documentType === "invoice" ? undefined : "Compliance check / اختبار الامتثال",
      paymentMeansCode: "10"
    });
    const signed = signDocument(unsigned, {
      privateKey: material.privateKey,
      certificate: material.certificate,
      sellerName: seller.name,
      vatNumber: seller.vatNumber,
      simplified: shape.invoiceType === "simplified",
      signedAt: issuedAt
    });
    try {
      const result = await submitComplianceDocument(cfg, material.credential, { invoiceHash: signed.invoiceHash, uuid: unsigned.uuid, xml: signed.xml }, { fetch: deps.fetch });
      checks[kind] = {
        passed: result.outcome === "accepted" || result.outcome === "accepted_with_warnings",
        at: now().toISOString(),
        warnings: result.warnings,
        errors: result.errors
      };
    } catch (err) {
      if (!(err instanceof FatooraError)) throw err;
      return updateEgsUnit(sb, merchant.id, { compliance_checks: checks, last_error: errorFrom(err, `compliance:${kind}`, now()) }, row.csr_pem);
    }
    previousHash = signed.invoiceHash;
    current = await updateEgsUnit(sb, merchant.id, { compliance_checks: checks }, row.csr_pem);
  }

  const failed = kinds.filter((k) => !checks[k]?.passed);
  if (failed.length) {
    const details = failed.flatMap((k) => (checks[k]?.errors ?? []).map((e) => ({ ...e, category: `${k}: ${e.category ?? ""}`.trim() })));
    return updateEgsUnit(
      sb,
      merchant.id,
      {
        last_error: {
          code: "compliance_check_failed",
          message: `ZATCA's compliance checks failed for: ${failed.join(", ")}. ${describe(details)} / فشلت فحوص الامتثال لدى زاتكا.`,
          details,
          at: now().toISOString(),
          step: "compliance_checks"
        }
      },
      row.csr_pem
    );
  }
  void current;
  return updateEgsUnit(sb, merchant.id, { status: "compliance_passed", last_error: null }, row.csr_pem);
}

async function issueProductionCsid(sb: SupabaseClient, merchant: OnboardingMerchant, cfg: ZatcaConfig, row: EgsRow, deps: Deps): Promise<EgsRow> {
  const now = deps.now ?? (() => new Date());
  const material = complianceMaterial(row);
  let csid;
  try {
    csid = await requestProductionCsid(
      cfg,
      { complianceToken: material.credential.token, complianceSecret: material.credential.secret, complianceRequestId: material.requestId },
      { fetch: deps.fetch }
    );
  } catch (err) {
    if (!(err instanceof FatooraError)) throw err;
    return updateEgsUnit(sb, merchant.id, { last_error: errorFrom(err, "production_csid", now()) }, row.csr_pem);
  }
  const certificate = certificateFromSecurityToken(csid.binarySecurityToken);
  const ownKey = createPublicKey(material.privateKey).export({ type: "spki", format: "der" });
  // ZATCA's developer-portal sandbox hands out one fixed test certificate (VAT 399999999900003); in
  // simulation and production the certificate must carry this unit's own key.
  if (!certificate.publicKey.equals(ownKey) && cfg.environment !== "sandbox") {
    return updateEgsUnit(
      sb,
      merchant.id,
      { last_error: { code: "certificate_key_mismatch", message: ZATCA_STEP_MESSAGES.bad_certificate, at: now().toISOString(), step: "production_csid" } },
      row.csr_pem
    );
  }
  const onboardedAt = now().toISOString();
  const active = await updateEgsUnit(
    sb,
    merchant.id,
    {
      ...encryptedProductionCsid({ token: csid.binarySecurityToken, secret: csid.secret }),
      status: "active",
      certificate_serial: certificate.serialNumber,
      certificate_issuer: certificate.issuerName,
      certificate_not_after: certificate.notAfter.toISOString(),
      onboarded_at: onboardedAt,
      last_error: null
    },
    row.csr_pem
  );
  const { error } = await sb.from("merchants").update({ zatca_onboarded_at: onboardedAt }).eq("id", merchant.id);
  if (error) throw new Error(`recording zatca_onboarded_at failed: ${error.message}`);
  return active;
}

/**
 * Start, resume or restart onboarding and run it as far as it gets. Request-level problems throw
 * HttpError (tax profile incomplete, OTP missing/refused, ZATCA unreachable before anything was
 * stored); a failed later step is returned in `lastError` and can be resumed without a new OTP.
 */
export async function runOnboarding(
  sb: SupabaseClient,
  merchant: OnboardingMerchant,
  cfg: ZatcaConfig,
  opts: OnboardingOptions,
  deps: Deps = {}
): Promise<EgsPublicStatus> {
  const problems = taxProfileProblems(merchant);
  if (problems.length) {
    throw new HttpError(409, `Complete the ZATCA tax details first: ${describeTaxProfileProblems(problems)}`, "tax_profile_incomplete");
  }

  let row = await loadEgsRow(sb, merchant.id);
  const usable = row && row.environment === cfg.environment ? row : null;
  if (usable?.status === "active" && !opts.restart) {
    return publicEgsStatus(usable, cfg);
  }
  const start = !usable || usable.status === "active" || (Boolean(opts.otp) && Boolean(opts.restart));
  if (start) {
    row = await issueComplianceCsid(sb, merchant, cfg, opts, deps);
  } else {
    row = usable;
  }
  if (row!.status === "compliance_issued") row = await runComplianceChecks(sb, merchant, cfg, row!, deps);
  if (row!.status === "compliance_passed") row = await issueProductionCsid(sb, merchant, cfg, row!, deps);
  return publicEgsStatus(row, cfg);
}
