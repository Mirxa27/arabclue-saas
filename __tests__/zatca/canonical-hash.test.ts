/**
 * F14 — the cryptographic rules of ZATCA Phase 2, checked against official vectors:
 *  - ZATCA's SDK sample Simplified_Invoice.xml (__tests__/fixtures/zatca): our parser + C14N 1.1
 *    reproduce its invoice hash, our SignedProperties serialisation reproduces its digest, its
 *    signature verifies the way we sign (SHA-256 ECDSA over the 32 hash bytes), its certificate
 *    digest / issuer / serial come out the same, and its QR decodes to tags 1–9;
 *  - the worked QR example of the E-invoicing Detailed Technical Guideline §6.2 (hash, signature,
 *    public key) verifies the same way;
 *  - documents we generate: libxml2's independent C14N 1.1 (xmllint, when installed) gives the same
 *    hash, and re-parsing the published XML gives back the hash and the SignedProperties digest.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { createHash, createPublicKey, verify } from "crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { parseXml } from "@/lib/zatca/xml-parse";
import { canonicalize, el, findChild, type XmlElement } from "@/lib/zatca/xml";
import { computeInvoiceHash, digestSignedPropertiesElement, invoiceHashInput, signDocument, verifyInvoiceSignature } from "@/lib/zatca/signing";
import { certificateHash, parseCertificate } from "@/lib/zatca/certificate";
import { decodeQrPayload } from "@/lib/zatca/qr";
import { buildUnsignedDocument, GENESIS_PREVIOUS_INVOICE_HASH } from "@/lib/zatca/invoice";
import { buildEgsCsr, generateEgsKeyPair } from "@/lib/zatca/csr";
import { issueTestCertificate, readCsr } from "../helpers/zatca-fakes";

const SAMPLE = readFileSync(path.join(__dirname, "../fixtures/zatca/sdk-simplified-invoice.xml"), "utf8");
const pick = (xml: string, re: RegExp) => {
  const m = re.exec(xml);
  if (!m) throw new Error(`not found: ${re}`);
  return m[1];
};

function descend(node: XmlElement, ...names: string[]): XmlElement {
  let cur = node;
  for (const n of names) {
    const next = findChild(cur, n);
    if (!next) throw new Error(`missing ${n}`);
    cur = next;
  }
  return cur;
}

describe("ZATCA SDK sample Simplified_Invoice.xml", () => {
  const root = parseXml(SAMPLE);
  const signature = descend(root, "ext:UBLExtensions", "ext:UBLExtension", "ext:ExtensionContent", "sig:UBLDocumentSignatures", "sac:SignatureInformation", "ds:Signature");
  const digestValue = pick(SAMPLE, /<ds:Reference Id="invoiceSignedData"[\s\S]*?<ds:DigestValue>([^<]+)</);

  it("our C14N 1.1 of the document without UBLExtensions, cac:Signature and the QR reproduces its invoice hash", () => {
    expect(digestValue).toBe("r/2si60BEew0NQCHNHNejowLDLjVNV/VTT/P8QSLxMk=");
    expect(computeInvoiceHash(root)).toBe(digestValue);
    // the whitespace the removed blocks leave behind is part of the hash input (as in ZATCA's SDK)
    expect(invoiceHashInput(root).startsWith('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')).toBe(true);
    expect(invoiceHashInput(root)).not.toContain("UBLExtensions");
  });

  it("our SignedProperties serialisation reproduces its signed-properties digest", () => {
    const props = descend(signature, "ds:Object", "xades:QualifyingProperties", "xades:SignedProperties");
    const expected = pick(SAMPLE, /URI="#xadesSignedProperties">[\s\S]*?<ds:DigestValue>([^<]+)</);
    expect(Buffer.from(expected, "base64").toString()).toMatch(/^[0-9a-f]{64}$/); // Base64 of the hex digest
    expect(digestSignedPropertiesElement(props)).toBe(expected);
  });

  it("its signature is SHA-256 ECDSA over the 32 hash bytes, with the embedded certificate's key", () => {
    const cert = parseCertificate(pick(SAMPLE, /<ds:X509Certificate>([^<]+)</));
    const signatureValue = pick(SAMPLE, /<ds:SignatureValue>([^<]+)</);
    expect(verifyInvoiceSignature(digestValue, signatureValue, cert.publicKey)).toBe(true);
    // and NOT over the Base64 text of the hash
    const key = createPublicKey({ key: cert.publicKey, format: "der", type: "spki" });
    expect(verify("sha256", Buffer.from(digestValue, "utf8"), key, Buffer.from(signatureValue, "base64"))).toBe(false);
  });

  it("certificate digest, issuer name and serial number are formed as in the sample", () => {
    const certB64 = pick(SAMPLE, /<ds:X509Certificate>([^<]+)</);
    const cert = parseCertificate(certB64);
    expect(certificateHash(certB64)).toBe(pick(SAMPLE, /<xades:CertDigest>[\s\S]*?<ds:DigestValue>([^<]+)</));
    expect(cert.issuerName).toBe(pick(SAMPLE, /<ds:X509IssuerName>([^<]+)</));
    expect(cert.serialNumber).toBe(pick(SAMPLE, /<ds:X509SerialNumber>([^<]+)</));
  });

  it("its QR carries tags 1–9: hash and signature as Base64 text, DER public key, the CA's certificate signature", () => {
    const qr = decodeQrPayload(pick(SAMPLE, /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</));
    const cert = parseCertificate(pick(SAMPLE, /<ds:X509Certificate>([^<]+)</));
    expect(qr.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(qr.vatNumber).toBe(pick(SAMPLE, /<cac:PartyTaxScheme>\s*<cbc:CompanyID>([^<]+)</));
    expect(qr.invoiceHash).toBe(digestValue);
    expect(qr.signatureValue).toBe(pick(SAMPLE, /<ds:SignatureValue>([^<]+)</));
    expect(qr.publicKey?.equals(cert.publicKey)).toBe(true);
    expect(qr.certificateSignature?.equals(cert.signature)).toBe(true);
  });
});

describe("E-invoicing Detailed Technical Guideline §6.2 worked QR example", () => {
  it("tag 7 is SHA-256 ECDSA over the tag-6 hash bytes, verifiable with the tag-8 key", () => {
    const hash = "QnVEexW4nWv4CaE39a/66Jp/OXO/evHQ8pDlG7weq/4=";
    const sig = "MEUCIQD5zxyXOB7NvWf62rVEZAYU71jpy9HEEnZ0q9O96wrL6QIgQJzCGHbw6YBHLYVdO1wnUhBgKm8jMTyvck9M+rP9xYY=";
    const spki = Buffer.from(
      "3056301006072a8648ce3d020106052b8104000a0342000461830ca0e68560084c3bfb2d7a8b5f6726afafaa75d524a5c2c2bd6b39ac2d8edbd5bf852e1a8c02b841d9da8729ba31a8a35fbe428378f869aa3ba2e61727d1",
      "hex"
    );
    expect(verifyInvoiceSignature(hash, sig, spki)).toBe(true);
  });
});

describe("C14N 1.1 serialisation rules", () => {
  it("sorts namespace declarations (default first) before attributes, expands empty elements and escapes per C14N", () => {
    const doc = el(
      "r",
      { z: 'q"&<\t\n', xmlns: "urn:d", "xmlns:b": "urn:b", "xmlns:a": "urn:a", a: "1" },
      el("a:x", null),
      el("b:y", { "xmlns:b": "urn:b" }, "1 < 2 & 3 > 0\r"),
      "نص عربي"
    );
    expect(canonicalize(doc)).toBe(
      '<r xmlns="urn:d" xmlns:a="urn:a" xmlns:b="urn:b" a="1" z="q&quot;&amp;&lt;&#x9;&#xA;"><a:x></a:x><b:y>1 &lt; 2 &amp; 3 &gt; 0\n</b:y>نص عربي</r>'
    );
  });

  it("refuses an element whose prefix is not declared", () => {
    expect(() => canonicalize(el("cbc:ID", null, "x"))).toThrow(/not declared/);
  });
});

describe("documents arabclue signs", () => {
  const keys = generateEgsKeyPair();
  const csr = buildEgsCsr(
    {
      environment: "sandbox",
      commonName: "arabclue-test",
      organizationName: "Bait Al Oud",
      organizationUnit: "Riyadh",
      egsSerialNumber: "1-arabclue|2-salla-v1|3-test",
      vatNumber: "399999999900003",
      invoiceTypes: "1100",
      location: "1234 King Fahd Rd, Al Olaya, Riyadh 12211",
      industry: "Retail"
    },
    keys.privateKey
  );
  const { spki, subject } = readCsr(csr.pem);
  const certificate = parseCertificate(issueTestCertificate({ spki, subject }).toString("base64"));
  const unsigned = buildUnsignedDocument({
    invoiceType: "simplified",
    documentType: "invoice",
    invoiceNumber: "INV-1 & <2>",
    issuedAt: new Date("2026-11-06T10:15:00Z"),
    icv: 1,
    previousInvoiceHash: GENESIS_PREVIOUS_INVOICE_HASH,
    seller: {
      name: "شركة بيت العود \"Bait\" & Co",
      vatNumber: "399999999900003",
      crNumber: "1010010000",
      address: { street: "طريق الملك فهد", building: "1234", district: "العليا", city: "الرياض", postalCode: "12211" }
    },
    buyer: { name: "محمد <علي>" },
    lines: [
      { name: "دهن عود 'ملكي' 12ml", quantity: 3, unitPrice: 33.333333333333336, vatRate: 0.15 },
      { name: "رسوم الشحن", quantity: 1, unitPrice: 15, vatRate: 0.15 }
    ]
  });
  const signed = signDocument(unsigned, { privateKey: keys.privateKey, certificate, sellerName: "شركة بيت العود \"Bait\" & Co", vatNumber: "399999999900003", simplified: true });

  it("re-parsing the published XML gives back the same hash and SignedProperties digest", () => {
    const reparsed = parseXml(signed.xml);
    expect(computeInvoiceHash(reparsed)).toBe(signed.invoiceHash);
    const props = descend(reparsed, "ext:UBLExtensions", "ext:UBLExtension", "ext:ExtensionContent", "sig:UBLDocumentSignatures", "sac:SignatureInformation", "ds:Signature", "ds:Object", "xades:QualifyingProperties", "xades:SignedProperties");
    expect(digestSignedPropertiesElement(props)).toBe(pick(signed.xml, /URI="#xadesSignedProperties">[\s\S]*?<ds:DigestValue>([^<]+)</));
  });

  it("libxml2's C14N 1.1 of the stripped document gives the same hash (independent implementation)", () => {
    let available = true;
    try {
      execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    } catch {
      available = false;
    }
    if (!available) return; // xmllint not installed: covered by the SDK vector above
    const dir = mkdtempSync(path.join(tmpdir(), "zatca-c14n-"));
    const stripped = signed.xml
      .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "")
      .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "")
      .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
    writeFileSync(path.join(dir, "doc.xml"), stripped);
    const c14n = execFileSync("xmllint", ["--c14n11", path.join(dir, "doc.xml")]);
    expect(createHash("sha256").update(c14n).digest("base64")).toBe(signed.invoiceHash);
  });
});
