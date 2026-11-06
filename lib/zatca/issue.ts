/**
 * Issue and submit ZATCA documents for a merchant whose EGS unit is active (F14 / F09).
 *
 * issueDocument: build → sign → zatca_append_invoice. The SQL function allocates ICV and PIH under
 * the merchant's head-row lock and refuses a stale head ('head_moved'); we then re-sign with the head
 * it reports and try again, so the chain never forks and an ICV is never reused. A Salla order that
 * already has a live invoice comes back as 'duplicate_order' (webhook redelivery is idempotent).
 * Any database error throws, so a webhook claim is released and the delivery retried.
 *
 * submitInvoice: simplified → reporting, standard → clearance (ZATCA's stamped XML is stored as the
 * legal document; a 303 "clearance disabled" falls back to reporting). Validation outcomes and
 * ZATCA's warnings/errors are persisted on the invoice; transport failures leave it 'failed' for a
 * retry (resubmitting the same document is safe: Fatoora answers it again — zatca-phase2.md §API).
 */
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import type { InvoiceStatus } from "@/lib/types/database";
import type { ZatcaConfig, ZatcaEnvironment } from "@/lib/zatca/config";
import type { SigningMaterial } from "@/lib/zatca/egs-store";
import {
  clearDocument,
  FatooraError,
  reportDocument,
  type FatooraClientOptions,
  type FatooraMessage,
  type SubmissionOutcome,
  type SubmissionResult
} from "@/lib/zatca/fatoora";
import {
  buildUnsignedDocument,
  GENESIS_PREVIOUS_INVOICE_HASH,
  type BuyerInfo,
  type InvoiceLine,
  type SellerInfo,
  type ZatcaDocumentType,
  type ZatcaInvoiceType
} from "@/lib/zatca/invoice";
import { decimalToString } from "@/lib/zatca/money";
import { signDocument } from "@/lib/zatca/signing";

const MAX_APPEND_ATTEMPTS = 6;

export type IssueRequest = {
  invoiceType: ZatcaInvoiceType;
  documentType: ZatcaDocumentType;
  invoiceNumber: string;
  seller: SellerInfo;
  buyer?: BuyerInfo;
  lines: InvoiceLine[];
  sallaOrderId?: string | null;
  supplyDate?: Date;
  billingReference?: string;
  reason?: string;
  /** A rejected invoice this document replaces (reissue). */
  supersedes?: string | null;
};

export type IssueOutcome = { outcome: "inserted" | "duplicate_order"; invoiceId: string };

const AppendResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("inserted"), id: z.string() }),
  z.object({ outcome: z.literal("duplicate_order"), id: z.string() }),
  z.object({ outcome: z.literal("head_moved"), icv: z.number().int().positive(), previous_hash: z.string().min(1) }),
  z.object({ outcome: z.literal("not_supersedable") })
]);

type Head = { icv: number; previousHash: string };

async function readHead(sb: SupabaseClient, merchantId: string, environment: ZatcaEnvironment): Promise<Head> {
  const { data, error } = await sb
    .from("zatca_chain_heads")
    .select("last_icv, last_hash, environment")
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw new Error(`zatca_chain_heads lookup failed: ${error.message}`);
  const row = data as { last_icv: number; last_hash: string | null; environment: string | null } | null;
  // No head yet: zatca_append_invoice answers with the right ICV (it continues legacy invoices).
  if (!row) return { icv: 1, previousHash: GENESIS_PREVIOUS_INVOICE_HASH };
  const fresh = !row.last_hash || row.environment !== environment;
  return { icv: row.last_icv + 1, previousHash: fresh ? GENESIS_PREVIOUS_INVOICE_HASH : row.last_hash! };
}

/** What a reissue needs to rebuild the document (the seller comes from the current tax profile). */
export type StoredIssueInput = Pick<IssueRequest, "invoiceType" | "documentType" | "invoiceNumber" | "buyer" | "lines" | "billingReference" | "reason"> & {
  sallaOrderId: string | null;
  supplyDate: string | null;
};

function issueInputOf(req: IssueRequest): StoredIssueInput {
  return {
    invoiceType: req.invoiceType,
    documentType: req.documentType,
    invoiceNumber: req.invoiceNumber,
    buyer: req.buyer,
    lines: req.lines,
    billingReference: req.billingReference,
    reason: req.reason,
    sallaOrderId: req.sallaOrderId ?? null,
    supplyDate: req.supplyDate ? req.supplyDate.toISOString() : null
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function issueDocument(
  sb: SupabaseClient,
  merchantId: string,
  cfg: ZatcaConfig,
  material: SigningMaterial,
  req: IssueRequest,
  deps: { now?: () => Date } = {}
): Promise<IssueOutcome> {
  let head = await readHead(sb, merchantId, cfg.environment);
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const issuedAt = deps.now?.() ?? new Date();
    const unsigned = buildUnsignedDocument({
      invoiceType: req.invoiceType,
      documentType: req.documentType,
      invoiceNumber: req.invoiceNumber,
      uuid: randomUUID(),
      issuedAt,
      icv: head.icv,
      previousInvoiceHash: head.previousHash,
      seller: req.seller,
      buyer: req.buyer,
      lines: req.lines,
      supplyDate: req.supplyDate,
      billingReference: req.billingReference,
      reason: req.reason,
      paymentMeansCode: "10"
    });
    const signed = signDocument(unsigned, {
      privateKey: material.privateKey,
      certificate: material.certificate,
      sellerName: req.seller.name,
      vatNumber: req.seller.vatNumber,
      simplified: req.invoiceType === "simplified",
      signedAt: issuedAt
    });
    const { data, error } = await sb.rpc("zatca_append_invoice", {
      p_merchant_id: merchantId,
      p_icv: head.icv,
      p_previous_hash: head.previousHash,
      p_environment: cfg.environment,
      p_invoice: {
        invoice_number: req.invoiceNumber,
        uuid: unsigned.uuid,
        invoice_hash: signed.invoiceHash,
        qr_base64: signed.qr,
        xml: signed.xml,
        subtotal: decimalToString(unsigned.totals.taxExclusive, 2),
        vat: decimalToString(unsigned.totals.vat, 2),
        total: decimalToString(unsigned.totals.taxInclusive, 2),
        invoice_type: req.invoiceType,
        document_type: req.documentType,
        salla_order_id: req.sallaOrderId ?? null,
        issued_at: issuedAt.toISOString(),
        buyer_name: req.buyer?.name ?? null,
        buyer_vat_number: req.buyer?.vatNumber ?? null,
        issue_input: issueInputOf(req)
      },
      p_supersedes: req.supersedes ?? null
    });
    if (error) throw new Error(`zatca_append_invoice failed: ${error.message}`);
    const result = AppendResultSchema.parse(data);
    switch (result.outcome) {
      case "inserted":
        return { outcome: "inserted", invoiceId: result.id };
      case "duplicate_order":
        return { outcome: "duplicate_order", invoiceId: result.id };
      case "not_supersedable":
        throw new HttpError(409, "Only a rejected invoice can be reissued. / يمكن إعادة إصدار الفاتورة المرفوضة فقط.", "not_reissuable");
      case "head_moved":
        head = { icv: result.icv, previousHash: result.previous_hash };
        if (attempt > 1) await pause(25 * attempt + Math.floor(Math.random() * 50));
    }
  }
  throw new Error(`could not append the invoice after ${MAX_APPEND_ATTEMPTS} attempts (concurrent issuance)`);
}

// ── submission ─────────────────────────────────────────────────────────────

export type SubmittableInvoice = {
  id: string;
  uuid: string;
  invoice_hash: string;
  xml: string;
  invoice_type: ZatcaInvoiceType | null;
  environment: ZatcaEnvironment | null;
  submission_attempts?: number | null;
  superseded_by?: string | null;
};

export type SubmissionSummary = {
  status: InvoiceStatus;
  outcome: SubmissionOutcome | "transport_error";
  warnings: FatooraMessage[];
  errors: FatooraMessage[];
  /** A later retry of the same document may succeed. */
  retryable: boolean;
  message?: string;
};

function qrFromXml(xml: string): string | null {
  const m = /<cbc:ID>\s*QR\s*<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=\s]+)<\/cbc:EmbeddedDocumentBinaryObject>/.exec(xml);
  return m ? m[1].replace(/\s+/g, "") : null;
}

export async function submitInvoice(
  sb: SupabaseClient,
  invoice: SubmittableInvoice,
  cfg: ZatcaConfig,
  material: SigningMaterial,
  opts: FatooraClientOptions = {}
): Promise<SubmissionSummary> {
  if (!invoice.invoice_type) {
    throw new HttpError(409, "This invoice was generated before Phase-2 signing and cannot be submitted. / أُنشئت هذه الفاتورة قبل التوقيع الرقمي ولا يمكن إرسالها.", "legacy_invoice");
  }
  if (invoice.environment !== cfg.environment) {
    throw new HttpError(409, `This invoice belongs to the ZATCA ${invoice.environment} environment. / هذه الفاتورة تخص بيئة أخرى لدى زاتكا.`, "environment_mismatch");
  }
  if (invoice.superseded_by) throw new HttpError(409, "This invoice was replaced by a reissued one. / استُبدلت هذه الفاتورة بأخرى.", "superseded");

  const doc = { invoiceHash: invoice.invoice_hash, uuid: invoice.uuid, xml: invoice.xml };
  const attempts = (invoice.submission_attempts ?? 0) + 1;
  const submittedAt = new Date().toISOString();
  let result: SubmissionResult;
  try {
    result = invoice.invoice_type === "standard" ? await clearDocument(cfg, material.credential, doc, opts) : await reportDocument(cfg, material.credential, doc, opts);
    if (result.outcome === "clearance_disabled") result = await reportDocument(cfg, material.credential, doc, opts);
  } catch (err) {
    if (!(err instanceof FatooraError)) throw err;
    const rejected = err.kind === "invalid_request" || err.kind === "bad_response";
    const status: InvoiceStatus = rejected ? "rejected" : "failed";
    const message =
      err.kind === "unauthorized"
        ? "ZATCA rejected this store's credentials — onboard ZATCA again in Settings. / رفضت زاتكا بيانات الاعتماد — أعد التسجيل من الإعدادات."
        : err.transient
          ? "ZATCA could not be reached; the invoice will be sent again automatically. / تعذر الوصول إلى زاتكا؛ ستُرسل الفاتورة تلقائياً لاحقاً."
          : "ZATCA could not read this invoice. / لم تتمكن زاتكا من قراءة الفاتورة.";
    const { error } = await sb
      .from("invoices")
      .update({
        status,
        fatoora_response: { error: { kind: err.kind, httpStatus: err.httpStatus, message: err.message }, at: submittedAt },
        validation_errors: err.errors.length ? err.errors : null,
        submitted_at: submittedAt,
        submission_attempts: attempts
      })
      .eq("id", invoice.id);
    if (error) throw new Error(`recording the ZATCA failure failed: ${error.message}`);
    return { status, outcome: "transport_error", warnings: [], errors: err.errors, retryable: err.transient, message };
  }

  const accepted = result.outcome === "accepted" || result.outcome === "accepted_with_warnings";
  const cleared = accepted && result.clearanceStatus === "CLEARED";
  const status: InvoiceStatus = !accepted ? "rejected" : cleared ? "cleared" : "reported";
  const clearedQr = cleared && result.clearedXml ? qrFromXml(result.clearedXml) : null;
  const { error } = await sb
    .from("invoices")
    .update({
      status,
      fatoora_response: result.raw,
      validation_warnings: result.warnings.length ? result.warnings : null,
      validation_errors: result.errors.length ? result.errors : null,
      ...(cleared && result.clearedXml ? { cleared_xml: result.clearedXml } : {}),
      ...(clearedQr ? { qr_base64: clearedQr } : {}),
      submitted_at: submittedAt,
      submission_attempts: attempts
    })
    .eq("id", invoice.id);
  if (error) throw new Error(`recording the ZATCA result failed: ${error.message}`);
  return { status, outcome: result.outcome, warnings: result.warnings, errors: result.errors, retryable: false };
}
