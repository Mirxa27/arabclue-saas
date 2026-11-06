/**
 * Test doubles for ZATCA Fatoora — test code only.
 *
 * fakeFatoora() answers the five V2 endpoints like the developer-portal sandbox does (shapes recorded
 * in data/research/zatca-phase2.md), but issues REAL X.509 certificates for the submitted CSR's key
 * (signed by a throwaway test CA) and re-checks every submitted document: invoice hash recomputed
 * from the XML (parse + C14N), ECDSA signature against the embedded certificate, QR tags 6–8.
 */
import { createHash, createPublicKey, generateKeyPairSync, sign, verify, X509Certificate } from "crypto";
import { child, contextConstructed, decodeDer, integer, oid, sequence, setOf, tlv, utf8String, bitString, TAG } from "@/lib/zatca/der";
import { parseXml } from "@/lib/zatca/xml-parse";
import { computeInvoiceHash } from "@/lib/zatca/signing";
import { decodeQrPayload } from "@/lib/zatca/qr";

const CA_KEY = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;

function utcTime(d: Date): Buffer {
  const s = d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  return tlv(TAG.UTC_TIME, Buffer.from(s, "ascii"));
}

/** A v3 certificate for `spki` with `subject` (raw DER Name), issued by the test CA. */
export function issueTestCertificate(args: { spki: Buffer; subject: Buffer; serial?: bigint; notAfter?: Date; issuerCn?: string }): Buffer {
  const issuer = sequence(setOf(sequence(oid("2.5.4.3"), utf8String(args.issuerCn ?? "Test eInvoicing CA"))));
  const tbs = sequence(
    contextConstructed(0, integer(2)),
    integer(args.serial ?? BigInt(Date.now())),
    sequence(oid("1.2.840.10045.4.3.2")),
    issuer,
    sequence(utcTime(new Date(Date.now() - 60_000)), utcTime(args.notAfter ?? new Date(Date.now() + 365 * 86_400_000))),
    args.subject,
    args.spki
  );
  return sequence(tbs, sequence(oid("1.2.840.10045.4.3.2")), bitString(sign("sha256", tbs, CA_KEY)));
}

/** The CSR's subject Name and SPKI (raw DER), after checking its self-signature. */
export function readCsr(csrPem: string): { subject: Buffer; spki: Buffer } {
  const der = Buffer.from(csrPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  const root = decodeDer(der);
  const info = child(root, 0, TAG.SEQUENCE);
  const spki = Buffer.from(child(info, 2, TAG.SEQUENCE).raw);
  const signature = child(root, 2, TAG.BIT_STRING).content.subarray(1);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  if (!verify("sha256", info.raw, key, signature)) throw new Error("CSR self-signature does not verify");
  return { subject: Buffer.from(child(info, 1, TAG.SEQUENCE).raw), spki };
}

export type FakeFatooraCall = { path: string; headers: Record<string, string>; body: Record<string, unknown> };

export type FakeFatoora = {
  fetch: typeof fetch;
  calls: FakeFatooraCall[];
  /** Override the answer for a path (e.g. to simulate an outage or a rejection). */
  respond: Map<string, (call: FakeFatooraCall) => Response | Promise<Response>>;
  otp: string;
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function validate(body: Record<string, unknown>): { errors: Array<Record<string, string>>; subtype: string } {
  const xml = Buffer.from(String(body.invoice ?? ""), "base64").toString("utf8");
  const errors: Array<Record<string, string>> = [];
  let subtype = "";
  try {
    const root = parseXml(xml);
    const hash = computeInvoiceHash(root);
    if (hash !== body.invoiceHash) errors.push({ type: "ERROR", code: "invalid-invoice-hash", category: "INVOICE_HASHING_ERRORS", message: "The invoice hash API body does not match the (calculated) Hash of the XML", status: "ERROR" });
    subtype = /<cbc:InvoiceTypeCode name="(\d+)"/.exec(xml)?.[1] ?? "";
    const cert = /<ds:X509Certificate>([^<]+)</.exec(xml)?.[1];
    const sig = /<ds:SignatureValue>([^<]+)</.exec(xml)?.[1];
    const digest = /<ds:Reference Id="invoiceSignedData"[\s\S]*?<ds:DigestValue>([^<]+)</.exec(xml)?.[1];
    if (!cert || !sig || digest !== hash) {
      errors.push({ type: "ERROR", code: "signature", category: "SIGNATURE_ERRORS", message: "missing or inconsistent signature", status: "ERROR" });
    } else {
      const key = new X509Certificate(Buffer.from(cert, "base64")).publicKey;
      if (!verify("sha256", Buffer.from(hash, "base64"), key, Buffer.from(sig, "base64"))) {
        errors.push({ type: "ERROR", code: "invalid-signature", category: "SIGNATURE_ERRORS", message: "signature does not verify", status: "ERROR" });
      }
      const qr = /<cbc:ID>QR<\/cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</.exec(xml)?.[1];
      const decoded = qr ? decodeQrPayload(qr) : null;
      const certKey = key.export({ type: "spki", format: "der" });
      if (!decoded || decoded.invoiceHash !== hash || decoded.signatureValue !== sig || !decoded.publicKey?.equals(certKey)) {
        errors.push({ type: "ERROR", code: "QRCODE_INVALID", category: "QRCODE_VALIDATION", message: "QR tags 6-8 do not match the document", status: "ERROR" });
      }
    }
  } catch (err) {
    errors.push({ type: "ERROR", code: "XSD_SCHEMA_ERROR", category: "XSD validation", message: err instanceof Error ? err.message : "bad xml", status: "ERROR" });
  }
  return { errors, subtype };
}

export function fakeFatoora(opts: { otp?: string } = {}): FakeFatoora {
  const otp = opts.otp ?? "123345";
  const calls: FakeFatooraCall[] = [];
  const respond = new Map<string, (call: FakeFatooraCall) => Response | Promise<Response>>();
  const issued = new Map<string, { csr: { subject: Buffer; spki: Buffer }; secret: string }>(); // token → material
  let compliance: { token: string; secret: string; requestId: string; spki: Buffer; subject: Buffer } | null = null;
  let production: { token: string; secret: string } | null = null;

  const tokenFor = (spki: Buffer, subject: Buffer) => Buffer.from(issueTestCertificate({ spki, subject }).toString("base64"), "utf8").toString("base64");
  const basic = (h: Record<string, string>) => Buffer.from((h.authorization ?? "").replace(/^Basic /, ""), "base64").toString("utf8");

  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = url.pathname.replace(/^\/e-invoicing\/[a-z-]+/, "");
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call = { path, headers, body };
    calls.push(call);
    const override = respond.get(path);
    if (override) return override(call);
    if (headers["accept-version"] !== "V2") return json(400, { errors: [{ code: "Invalid-Version", message: "accept-version" }] });

    if (path === "/compliance") {
      if (!headers.otp) return json(400, { errors: [{ code: "Missing-OTP", message: "OTP is required field" }] });
      if (headers.otp !== otp) return json(400, { errors: [{ code: "Invalid-OTP", message: "The provided OTP is invalid" }] });
      let csr;
      try {
        csr = readCsr(Buffer.from(String(body.csr), "base64").toString("utf8"));
      } catch {
        return new Response("Invalid Request", { status: 400 });
      }
      const token = tokenFor(csr.spki, csr.subject);
      compliance = { token, secret: `compliance-secret-${calls.length}`, requestId: "1234567890123", spki: csr.spki, subject: csr.subject };
      issued.set(token, { csr, secret: compliance.secret });
      return json(200, { requestID: 1234567890123, dispositionMessage: "ISSUED", binarySecurityToken: token, secret: compliance.secret, errors: null });
    }
    if (path === "/compliance/invoices") {
      if (!compliance || basic(headers) !== `${compliance.token}:${compliance.secret}`) return new Response("", { status: 401 });
      const { errors, subtype } = validate(body);
      const standard = subtype.startsWith("01");
      return json(errors.length ? 400 : 200, {
        validationResults: { infoMessages: [], warningMessages: [], errorMessages: errors, status: errors.length ? "ERROR" : "PASS" },
        reportingStatus: standard ? null : errors.length ? "NOT_REPORTED" : "REPORTED",
        clearanceStatus: standard ? (errors.length ? "NOT_CLEARED" : "CLEARED") : null
      });
    }
    if (path === "/production/csids") {
      if (!compliance || basic(headers) !== `${compliance.token}:${compliance.secret}`) return new Response("", { status: 401 });
      if (body.compliance_request_id !== compliance.requestId) return json(400, { code: "Incorrect-ComplianceRequestId", message: "compliance_request_id must be 13 digits" });
      production = { token: tokenFor(compliance.spki, compliance.subject), secret: "production-secret" };
      return json(200, { requestID: 30368, tokenType: "x509", dispositionMessage: "ISSUED", binarySecurityToken: production.token, secret: production.secret });
    }
    if (path === "/invoices/reporting/single" || path === "/invoices/clearance/single") {
      if (!production || basic(headers) !== `${production.token}:${production.secret}`) return new Response("", { status: 401 });
      const { errors, subtype } = validate(body);
      const clearance = path.endsWith("clearance/single");
      if (clearance && !subtype.startsWith("01")) {
        errors.push({ type: "ERROR", code: "XML-INVOICE-ERROR", category: "INVOICETYPE_ERRORS", message: "XML Submitted using clearance API is not a Standard TAX document ", status: "ERROR" });
      }
      const validationResults = { infoMessages: [], warningMessages: [], errorMessages: errors, status: errors.length ? "ERROR" : "PASS" };
      if (clearance) {
        return json(errors.length ? 400 : 200, {
          validationResults,
          clearanceStatus: errors.length ? "NOT_CLEARED" : "CLEARED",
          clearedInvoice: errors.length ? null : String(body.invoice)
        });
      }
      return json(errors.length ? 400 : 200, { validationResults, reportingStatus: errors.length ? "NOT_REPORTED" : "REPORTED" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { fetch: doFetch, calls, respond, otp };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("base64");
