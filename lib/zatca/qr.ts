/**
 * ZATCA QR code payload: Base64 of Tag-Length-Value fields (Security Features Implementation
 * Standards v1.2 §4; E-invoicing Detailed Technical Guideline §6 incl. its worked hex example).
 *
 *   1 seller name (UTF-8)            2 seller VAT number          3 IssueDate + "T" + IssueTime + "Z"
 *   4 TaxInclusiveAmount             5 TaxTotal/TaxAmount (BT-110)
 *   6 invoice hash (its Base64 text) 7 ECDSA signature (its Base64 text)
 *   8 EGS public key (DER SubjectPublicKeyInfo bytes)
 *   9 simplified documents only: the CA's ECDSA signature over the EGS certificate (DER bytes)
 *
 * Tag and length are one byte each, so every value must fit in 255 bytes.
 */

export type TlvEntry = { tag: number; value: Buffer };

export class QrTooLongError extends Error {
  constructor(readonly tag: number, readonly length: number) {
    super(`QR TLV tag ${tag} is ${length} bytes (max 255)`);
    this.name = "QrTooLongError";
  }
}

export function encodeTlv(entries: ReadonlyArray<{ tag: number; value: Buffer | string }>): Buffer {
  const parts: Buffer[] = [];
  for (const { tag, value } of entries) {
    if (!Number.isInteger(tag) || tag < 1 || tag > 255) throw new Error(`invalid TLV tag ${tag}`);
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    if (bytes.length > 255) throw new QrTooLongError(tag, bytes.length);
    parts.push(Buffer.from([tag, bytes.length]), bytes);
  }
  return Buffer.concat(parts);
}

export function decodeTlv(buf: Buffer): TlvEntry[] {
  const out: TlvEntry[] = [];
  let i = 0;
  while (i < buf.length) {
    if (i + 2 > buf.length) throw new Error("truncated TLV header");
    const tag = buf[i];
    const length = buf[i + 1];
    if (i + 2 + length > buf.length) throw new Error(`truncated TLV value for tag ${tag}`);
    out.push({ tag, value: buf.subarray(i + 2, i + 2 + length) });
    i += 2 + length;
  }
  return out;
}

export type QrFields = {
  sellerName: string;
  vatNumber: string;
  /** IssueDate and IssueTime exactly as printed in the XML. */
  issueDate: string;
  issueTime: string;
  /** TaxInclusiveAmount and TaxTotal/TaxAmount exactly as printed in the XML. */
  totalWithVat: string;
  vatTotal: string;
  /** Phase 2 (tags 6–8): Base64 invoice hash, Base64 signature value, DER public key. */
  invoiceHash?: string;
  signatureValue?: string;
  publicKey?: Buffer;
  /** Tag 9 — simplified documents: the CA's signature over the signing certificate. */
  certificateSignature?: Buffer;
};

/**
 * Tag 3: IssueDate "T" IssueTime exactly as printed in the XML. An AST time (hh:mm:ss) stays
 * without a zone and a UTC time keeps its "Z" (BR-KSA-70): Fatoora compares this instant with
 * KSA-25 and warns invoiceTimeStamp_QRCODE_INVALID when a "Z" is appended to an AST time (as the
 * DTG §6 sample pattern yyyy-MM-dd'T'HH:mm:ss'Z' would) — verified against the sandbox.
 */
export function qrTimestamp(issueDate: string, issueTime: string): string {
  return `${issueDate}T${issueTime}`;
}

export function buildQrPayload(fields: QrFields): string {
  const entries: Array<{ tag: number; value: Buffer | string }> = [
    { tag: 1, value: fields.sellerName },
    { tag: 2, value: fields.vatNumber },
    { tag: 3, value: qrTimestamp(fields.issueDate, fields.issueTime) },
    { tag: 4, value: fields.totalWithVat },
    { tag: 5, value: fields.vatTotal }
  ];
  if (fields.invoiceHash !== undefined) {
    if (!fields.signatureValue || !fields.publicKey) throw new Error("QR tags 6–8 need the hash, signature and public key together");
    entries.push({ tag: 6, value: fields.invoiceHash }, { tag: 7, value: fields.signatureValue }, { tag: 8, value: fields.publicKey });
  }
  if (fields.certificateSignature) entries.push({ tag: 9, value: fields.certificateSignature });
  return encodeTlv(entries).toString("base64");
}

export type DecodedQr = {
  sellerName?: string;
  vatNumber?: string;
  timestamp?: string;
  totalWithVat?: string;
  vatTotal?: string;
  invoiceHash?: string;
  signatureValue?: string;
  publicKey?: Buffer;
  certificateSignature?: Buffer;
  tags: number[];
};

export function decodeQrPayload(base64: string): DecodedQr {
  const entries = decodeTlv(Buffer.from(base64, "base64"));
  const text = (tag: number) => entries.find((e) => e.tag === tag)?.value.toString("utf8");
  const bytes = (tag: number) => entries.find((e) => e.tag === tag)?.value;
  return {
    sellerName: text(1),
    vatNumber: text(2),
    timestamp: text(3),
    totalWithVat: text(4),
    vatTotal: text(5),
    invoiceHash: text(6),
    signatureValue: text(7),
    publicKey: bytes(8),
    certificateSignature: bytes(9),
    tags: entries.map((e) => e.tag)
  };
}
