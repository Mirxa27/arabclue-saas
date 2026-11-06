/**
 * ZATCA Fatoora API client (V2): onboarding CSIDs, compliance checks, reporting and clearance.
 *
 *   POST /compliance                   OTP header + base64(CSR PEM)      → compliance CSID + requestID
 *   POST /compliance/invoices          compliance CSID (Basic)          → validation of one sample document
 *   POST /production/csids             compliance CSID + requestID      → production CSID
 *   POST /invoices/reporting/single    production CSID; simplified docs → REPORTED / NOT_REPORTED
 *   POST /invoices/clearance/single    production CSID; standard docs   → CLEARED (+ ZATCA-stamped XML)
 *
 * Auth: `Authorization: Basic base64(binarySecurityToken:secret)`, `Accept-Version: V2`
 * (Developer Portal manual §2.3.10 and §3). Response shapes and status codes recorded from the
 * developer-portal sandbox in data/research/zatca-phase2.md §API.
 *
 * A validation outcome (200 / 202 / 400 with validationResults) is a result, not an exception.
 * Transport problems, 401, 429 and 5xx throw FatooraError so callers can retry or surface them.
 */
import { basicCredential } from "@/lib/zatca/certificate";
import type { ZatcaConfig } from "@/lib/zatca/config";

export type FatooraMessage = {
  type?: string;
  code?: string;
  category?: string;
  message?: string;
  status?: string;
};

export type FatooraErrorKind =
  | "invalid_otp"
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "bad_response";

export class FatooraError extends Error {
  constructor(
    readonly kind: FatooraErrorKind,
    message: string,
    readonly httpStatus: number,
    readonly errors: FatooraMessage[] = []
  ) {
    super(message);
    this.name = "FatooraError";
  }

  /** Worth retrying later without changing anything. */
  get transient(): boolean {
    return this.kind === "unavailable" || this.kind === "rate_limited";
  }
}

export type Csid = {
  binarySecurityToken: string;
  secret: string;
  requestId: string;
  dispositionMessage: string | null;
};

export type SubmissionOutcome = "accepted" | "accepted_with_warnings" | "rejected" | "clearance_disabled";

export type SubmissionResult = {
  outcome: SubmissionOutcome;
  httpStatus: number;
  validationStatus: string | null;
  reportingStatus: string | null;
  clearanceStatus: string | null;
  /** Standard documents: the ZATCA-stamped invoice (the legal document), decoded. */
  clearedXml: string | null;
  info: FatooraMessage[];
  warnings: FatooraMessage[];
  errors: FatooraMessage[];
  /** The response without the cleared invoice blob (stored as invoices.fatoora_response). */
  raw: Record<string, unknown>;
};

export type DocumentSubmission = { invoiceHash: string; uuid: string; xml: string };

const DEFAULT_TIMEOUT_MS = 20_000;

type FetchLike = typeof fetch;

export type FatooraClientOptions = {
  timeoutMs?: number;
  fetch?: FetchLike;
};

function messages(value: unknown): FatooraMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .slice(0, 50)
    .map((m) => ({
      type: typeof m.type === "string" ? m.type : undefined,
      code: typeof m.code === "string" ? m.code.slice(0, 200) : undefined,
      category: typeof m.category === "string" ? m.category.slice(0, 200) : undefined,
      message: typeof m.message === "string" ? m.message.slice(0, 1000) : undefined,
      status: typeof m.status === "string" ? m.status : undefined
    }));
}

async function call(
  cfg: ZatcaConfig,
  path: string,
  init: { headers: Record<string, string>; body: unknown },
  opts: FatooraClientOptions
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { accept: "application/json", "accept-language": "en", "accept-version": "V2", "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store"
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new FatooraError("unavailable", timedOut ? "ZATCA did not answer in time" : "ZATCA could not be reached", 0);
  }
  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> | null = null;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  if (res.status === 401 || res.status === 403) throw new FatooraError("unauthorized", "ZATCA rejected the EGS credentials", res.status);
  if (res.status === 429) throw new FatooraError("rate_limited", "ZATCA is rate limiting requests", res.status);
  if (res.status >= 500) throw new FatooraError("unavailable", `ZATCA answered ${res.status}`, res.status);
  return { status: res.status, json, text };
}

/** {"errors":[…]} or {"code","message"} or plain text → messages. */
function errorList(json: Record<string, unknown> | null, text: string): FatooraMessage[] {
  if (json) {
    const list = messages(json.errors);
    if (list.length) return list;
    if (typeof json.code === "string" || typeof json.message === "string") return messages([json]);
    const vr = json.validationResults as Record<string, unknown> | undefined;
    if (vr) return messages(vr.errorMessages);
  }
  return text ? [{ message: text.slice(0, 500) }] : [];
}

function parseCsid(json: Record<string, unknown> | null): Csid {
  const token = json?.binarySecurityToken;
  const secret = json?.secret;
  const requestId = json?.requestID;
  if (typeof token !== "string" || !token || typeof secret !== "string" || !secret) {
    throw new FatooraError("bad_response", "ZATCA did not return a CSID", 200, errorList(json, ""));
  }
  return {
    binarySecurityToken: token,
    secret,
    requestId: requestId === undefined || requestId === null ? "" : String(requestId),
    dispositionMessage: typeof json?.dispositionMessage === "string" ? json.dispositionMessage : null
  };
}

/** Compliance CSID for a CSR, authorised by the taxpayer's one-time password from the Fatoora portal. */
export async function requestComplianceCsid(
  cfg: ZatcaConfig,
  args: { csrBase64: string; otp: string },
  opts: FatooraClientOptions = {}
): Promise<Csid> {
  const { status, json, text } = await call(cfg, "/compliance", { headers: { otp: args.otp }, body: { csr: args.csrBase64 } }, opts);
  if (status !== 200) {
    const errors = errorList(json, text);
    const otpProblem = errors.some((e) => /otp/i.test(`${e.code ?? ""} ${e.message ?? ""}`));
    throw new FatooraError(otpProblem ? "invalid_otp" : "invalid_request", "ZATCA refused the compliance CSID request", status, errors);
  }
  return parseCsid(json);
}

/** Production CSID, after every required compliance check passed. */
export async function requestProductionCsid(
  cfg: ZatcaConfig,
  args: { complianceToken: string; complianceSecret: string; complianceRequestId: string },
  opts: FatooraClientOptions = {}
): Promise<Csid> {
  const { status, json, text } = await call(
    cfg,
    "/production/csids",
    {
      headers: { authorization: `Basic ${basicCredential(args.complianceToken, args.complianceSecret)}` },
      body: { compliance_request_id: args.complianceRequestId }
    },
    opts
  );
  if (status !== 200) throw new FatooraError("invalid_request", "ZATCA refused the production CSID request", status, errorList(json, text));
  return parseCsid(json);
}

function submissionResult(status: number, json: Record<string, unknown> | null, text: string): SubmissionResult {
  if (status === 303) {
    return {
      outcome: "clearance_disabled",
      httpStatus: status,
      validationStatus: null,
      reportingStatus: null,
      clearanceStatus: null,
      clearedXml: null,
      info: [],
      warnings: [],
      errors: [],
      raw: json ?? {}
    };
  }
  const vr = (json?.validationResults ?? null) as Record<string, unknown> | null;
  if (!json || !vr) {
    // e.g. 400 "Invalid Request" for a body Fatoora cannot read at all
    if (status === 400 || status === 409 || status === 413) {
      throw new FatooraError("invalid_request", "ZATCA could not read the submission", status, errorList(json, text));
    }
    throw new FatooraError("bad_response", `Unexpected ZATCA response (${status})`, status, errorList(json, text));
  }
  const warnings = messages(vr.warningMessages);
  const errors = messages(vr.errorMessages);
  const reportingStatus = typeof json.reportingStatus === "string" ? json.reportingStatus : null;
  const clearanceStatus = typeof json.clearanceStatus === "string" ? json.clearanceStatus : null;
  const accepted = (status === 200 || status === 202) && errors.length === 0 && (reportingStatus === "REPORTED" || clearanceStatus === "CLEARED");
  let clearedXml: string | null = null;
  if (typeof json.clearedInvoice === "string" && json.clearedInvoice) {
    clearedXml = Buffer.from(json.clearedInvoice, "base64").toString("utf8");
  }
  const { clearedInvoice: _omit, ...raw } = json;
  void _omit;
  return {
    outcome: accepted ? (warnings.length ? "accepted_with_warnings" : "accepted") : "rejected",
    httpStatus: status,
    validationStatus: typeof vr.status === "string" ? vr.status : null,
    reportingStatus,
    clearanceStatus,
    clearedXml,
    info: messages(vr.infoMessages),
    warnings,
    errors,
    raw: { ...raw, ...(clearedXml ? { clearedInvoice: "[stored in invoices.cleared_xml]" } : {}) }
  };
}

function documentBody(doc: DocumentSubmission) {
  return { invoiceHash: doc.invoiceHash, uuid: doc.uuid, invoice: Buffer.from(doc.xml, "utf8").toString("base64") };
}

/** One compliance check (onboarding): validated like a real submission, nothing is reported. */
export async function submitComplianceDocument(
  cfg: ZatcaConfig,
  credential: { token: string; secret: string },
  doc: DocumentSubmission,
  opts: FatooraClientOptions = {}
): Promise<SubmissionResult> {
  const { status, json, text } = await call(
    cfg,
    "/compliance/invoices",
    { headers: { authorization: `Basic ${basicCredential(credential.token, credential.secret)}` }, body: documentBody(doc) },
    opts
  );
  return submissionResult(status, json, text);
}

/** Simplified (B2C) documents: reporting within 24 hours of issue. */
export async function reportDocument(
  cfg: ZatcaConfig,
  credential: { token: string; secret: string },
  doc: DocumentSubmission,
  opts: FatooraClientOptions = {}
): Promise<SubmissionResult> {
  const { status, json, text } = await call(
    cfg,
    "/invoices/reporting/single",
    { headers: { authorization: `Basic ${basicCredential(credential.token, credential.secret)}`, "clearance-status": "0" }, body: documentBody(doc) },
    opts
  );
  return submissionResult(status, json, text);
}

/** Standard (B2B) documents: clearance before the buyer receives them; ZATCA returns the stamped XML. */
export async function clearDocument(
  cfg: ZatcaConfig,
  credential: { token: string; secret: string },
  doc: DocumentSubmission,
  opts: FatooraClientOptions = {}
): Promise<SubmissionResult> {
  const { status, json, text } = await call(
    cfg,
    "/invoices/clearance/single",
    { headers: { authorization: `Basic ${basicCredential(credential.token, credential.secret)}`, "clearance-status": "1" }, body: documentBody(doc) },
    opts
  );
  return submissionResult(status, json, text);
}
