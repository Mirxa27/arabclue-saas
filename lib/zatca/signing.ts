/**
 * ZATCA cryptographic stamp: XAdES-B-B enveloped signature in ext:UBLExtensions, the QR code and
 * cac:Signature (Security Features Implementation Standards v1.2 §2.3.3, §3, §4; E-invoicing
 * Detailed Technical Guideline §5.2 "Signing steps"; data/research/zatca-phase2.md §Signing).
 *
 *  1. invoice hash  = Base64(SHA-256(C14N11(document without ext:UBLExtensions, cac:Signature and
 *                     the QR AdditionalDocumentReference)))   — also the next document's PIH
 *  2. signature     = Base64(ECDSA-secp256k1(SHA-256 over the 32 hash bytes)) — the "not encoded"
 *                     hash is the signed message (DTG step 2)
 *  3. cert digest   = Base64(hex(SHA-256(Base64 certificate text)))           (DTG step 3)
 *  4. SignedProperties with SigningTime, cert digest, issuer, serial          (DTG step 4)
 *  5. its digest    = Base64(hex(SHA-256(the linearised SignedProperties element as extracted from
 *                     the document: xmlns:xades on the element, xmlns:ds on each ds:* child)))
 *  6. SignedInfo references both digests; QR tags 1–9; cac:Signature.
 *
 * Standard documents are signed the same way; ZATCA adds its own stamp when it clears them.
 */
import { createHash, createPublicKey, sign as ecSign, verify as ecVerify, type KeyObject } from "crypto";
import { canonicalize, el, serializeFragment, toXmlDocument, type XmlElement, type XmlNode } from "@/lib/zatca/xml";
import { certificateHash, type EgsCertificate } from "@/lib/zatca/certificate";
import { buildQrPayload } from "@/lib/zatca/qr";
import { NS, type UnsignedDocument } from "@/lib/zatca/invoice";
import { formatAmount } from "@/lib/zatca/money";

const XPATH_TRANSFORMS = [
  "not(//ancestor-or-self::ext:UBLExtensions)",
  "not(//ancestor-or-self::cac:Signature)",
  "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"
];

const isElement = (n: XmlNode): n is XmlElement => typeof n !== "string";

function isQrReference(node: XmlElement): boolean {
  if (node.name !== "cac:AdditionalDocumentReference") return false;
  const id = node.children.find((c): c is XmlElement => isElement(c) && c.name === "cbc:ID");
  return Boolean(id && id.children.join("").trim() === "QR");
}

/** The document as ZATCA hashes it: the three excluded parts removed, then C14N 1.1. */
export function invoiceHashInput(root: XmlElement): string {
  const stripped: XmlElement = {
    ...root,
    children: root.children.filter((c) => !isElement(c) || !(c.name === "ext:UBLExtensions" || c.name === "cac:Signature" || isQrReference(c)))
  };
  return canonicalize(stripped);
}

export function computeInvoiceHash(root: XmlElement): string {
  return createHash("sha256").update(invoiceHashInput(root), "utf8").digest("base64");
}

/** ECDSA (SHA-256) over the 32 raw bytes of the invoice hash, DER-encoded, Base64. */
export function signInvoiceHash(invoiceHashBase64: string, privateKey: KeyObject): string {
  return ecSign("sha256", Buffer.from(invoiceHashBase64, "base64"), privateKey).toString("base64");
}

export function verifyInvoiceSignature(invoiceHashBase64: string, signatureBase64: string, publicKey: KeyObject | Buffer): boolean {
  const key = Buffer.isBuffer(publicKey) ? createPublicKey({ key: publicKey, format: "der", type: "spki" }) : publicKey;
  return ecVerify("sha256", Buffer.from(invoiceHashBase64, "base64"), key, Buffer.from(signatureBase64, "base64"));
}

function hexThenBase64(input: string): string {
  return Buffer.from(createHash("sha256").update(input, "utf8").digest("hex"), "utf8").toString("base64");
}

type SignedPropertiesFields = { signingTime: string; certificateDigest: string; issuerName: string; serialNumber: string };

/** xades:SignedProperties as it appears inside the signature (namespaces declared by ancestors). */
function signedPropertiesElement(f: SignedPropertiesFields): XmlElement {
  return el(
    "xades:SignedProperties",
    { Id: "xadesSignedProperties" },
    el(
      "xades:SignedSignatureProperties",
      null,
      el("xades:SigningTime", null, f.signingTime),
      el(
        "xades:SigningCertificate",
        null,
        el(
          "xades:Cert",
          null,
          el(
            "xades:CertDigest",
            null,
            el("ds:DigestMethod", { Algorithm: "http://www.w3.org/2001/04/xmlenc#sha256" }),
            el("ds:DigestValue", null, f.certificateDigest)
          ),
          el("xades:IssuerSerial", null, el("ds:X509IssuerName", null, f.issuerName), el("ds:X509SerialNumber", null, f.serialNumber))
        )
      )
    )
  );
}

/** Add the declarations an extracting serialiser writes: xmlns:xades on the apex, xmlns:ds on each ds:*. */
function withOwnNamespaces(node: XmlElement, isApex = true): XmlElement {
  const extra: Array<readonly [string, string]> = [];
  if (isApex) extra.push(["xmlns:xades", NS.xades]);
  if (node.name.startsWith("ds:")) extra.push(["xmlns:ds", NS.ds]);
  return {
    ...node,
    attrs: [...extra, ...node.attrs],
    children: node.children.map((c) => (typeof c === "string" ? c : withOwnNamespaces(c, false)))
  };
}

/**
 * The SignedProperties string ZATCA digests (DTG §5.2 step 5): the element exactly as it reads in
 * the document — whitespace included, empty elements self-closed — plus xmlns:xades on the element
 * and xmlns:ds on every ds:* element, as an XPath extraction serialises it. Reproduces the
 * SignedProperties DigestValue of ZATCA's SDK sample Simplified_Invoice.xml (zatca-phase2.md).
 * Our documents are linearised, so the element reads without whitespace.
 */
export function signedPropertiesDigestInput(f: SignedPropertiesFields): string {
  return serializeFragment(withOwnNamespaces(signedPropertiesElement(f)));
}

export function signedPropertiesDigest(f: SignedPropertiesFields): string {
  return hexThenBase64(signedPropertiesDigestInput(f));
}

/** The digest of a xades:SignedProperties element as found in a (parsed) document. */
export function digestSignedPropertiesElement(element: XmlElement): string {
  if (element.name !== "xades:SignedProperties") throw new Error("not a xades:SignedProperties element");
  return hexThenBase64(serializeFragment(withOwnNamespaces(element)));
}

function ublExtensions(args: {
  invoiceHash: string;
  signedPropertiesHash: string;
  signatureValue: string;
  certificate: string;
  signedProperties: XmlElement;
}): XmlElement {
  const transform = (xpath: string) => el("ds:Transform", { Algorithm: "http://www.w3.org/TR/1999/REC-xpath-19991116" }, el("ds:XPath", null, xpath));
  return el(
    "ext:UBLExtensions",
    null,
    el(
      "ext:UBLExtension",
      null,
      el("ext:ExtensionURI", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades"),
      el(
        "ext:ExtensionContent",
        null,
        el(
          "sig:UBLDocumentSignatures",
          { "xmlns:sig": NS.sig, "xmlns:sac": NS.sac, "xmlns:sbc": NS.sbc },
          el(
            "sac:SignatureInformation",
            null,
            el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:1"),
            el("sbc:ReferencedSignatureID", null, "urn:oasis:names:specification:ubl:signature:Invoice"),
            el(
              "ds:Signature",
              { "xmlns:ds": NS.ds, Id: "signature" },
              el(
                "ds:SignedInfo",
                null,
                el("ds:CanonicalizationMethod", { Algorithm: "http://www.w3.org/2006/12/xml-c14n11" }),
                el("ds:SignatureMethod", { Algorithm: "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256" }),
                el(
                  "ds:Reference",
                  { Id: "invoiceSignedData", URI: "" },
                  el("ds:Transforms", null, XPATH_TRANSFORMS.map(transform), el("ds:Transform", { Algorithm: "http://www.w3.org/2006/12/xml-c14n11" })),
                  el("ds:DigestMethod", { Algorithm: "http://www.w3.org/2001/04/xmlenc#sha256" }),
                  el("ds:DigestValue", null, args.invoiceHash)
                ),
                el(
                  "ds:Reference",
                  { Type: "http://www.w3.org/2000/09/xmldsig#SignatureProperties", URI: "#xadesSignedProperties" },
                  el("ds:DigestMethod", { Algorithm: "http://www.w3.org/2001/04/xmlenc#sha256" }),
                  el("ds:DigestValue", null, args.signedPropertiesHash)
                )
              ),
              el("ds:SignatureValue", null, args.signatureValue),
              el("ds:KeyInfo", null, el("ds:X509Data", null, el("ds:X509Certificate", null, args.certificate))),
              el(
                "ds:Object",
                null,
                el("xades:QualifyingProperties", { "xmlns:xades": NS.xades, Target: "signature" }, args.signedProperties)
              )
            )
          )
        )
      )
    )
  );
}

const SIGNATURE_BLOCK = el(
  "cac:Signature",
  null,
  el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:Invoice"),
  el("cbc:SignatureMethod", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades")
);

export type SignedDocument = {
  root: XmlElement;
  xml: string;
  invoiceHash: string;
  signatureValue: string;
  qr: string;
  signingTime: string;
};

/**
 * Sign an unsigned document with the EGS key + certificate. `includeCertificateSignature` adds QR
 * tag 9, which the standard requires for simplified documents.
 */
export function signDocument(
  doc: UnsignedDocument,
  args: { privateKey: KeyObject; certificate: EgsCertificate; signedAt?: Date; sellerName: string; vatNumber: string; simplified: boolean }
): SignedDocument {
  const invoiceHash = computeInvoiceHash(doc.root);
  const signatureValue = signInvoiceHash(invoiceHash, args.privateKey);
  // UTC with "Z", as in ZATCA's SDK samples (an unambiguous instant).
  const signingTime = `${(args.signedAt ?? new Date()).toISOString().slice(0, 19)}Z`;
  const props: SignedPropertiesFields = {
    signingTime,
    certificateDigest: certificateHash(args.certificate.base64),
    issuerName: args.certificate.issuerName,
    serialNumber: args.certificate.serialNumber
  };
  const extensions = ublExtensions({
    invoiceHash,
    signedPropertiesHash: signedPropertiesDigest(props),
    signatureValue,
    certificate: args.certificate.base64,
    signedProperties: signedPropertiesElement(props)
  });
  const qr = buildQrPayload({
    sellerName: args.sellerName,
    vatNumber: args.vatNumber,
    issueDate: doc.issueDate,
    issueTime: doc.issueTime,
    totalWithVat: formatAmount(doc.totals.taxInclusive),
    vatTotal: formatAmount(doc.totals.vat),
    invoiceHash,
    signatureValue,
    publicKey: args.certificate.publicKey,
    certificateSignature: args.simplified ? args.certificate.signature : undefined
  });
  const qrReference = el(
    "cac:AdditionalDocumentReference",
    null,
    el("cbc:ID", null, "QR"),
    el("cac:Attachment", null, el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, qr))
  );

  // Insert: UBLExtensions first; QR right after the last AdditionalDocumentReference, then cac:Signature.
  const children = [...doc.root.children];
  const lastAdr = children.reduce((idx, c, i) => (isElement(c) && c.name === "cac:AdditionalDocumentReference" ? i : idx), -1);
  if (lastAdr < 0) throw new Error("document has no ICV/PIH references");
  children.splice(lastAdr + 1, 0, qrReference, SIGNATURE_BLOCK);
  children.unshift(extensions);
  const root: XmlElement = { ...doc.root, children };

  // The excluded parts must not change the hash (sanity check of the exclusion rules).
  if (computeInvoiceHash(root) !== invoiceHash) throw new Error("signed document hash mismatch");
  return { root, xml: toXmlDocument(root), invoiceHash, signatureValue, qr, signingTime };
}
