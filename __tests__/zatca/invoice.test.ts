/**
 * F14 — the Phase-2 UBL document (lib/zatca/invoice.ts), money rules (lib/zatca/money.ts), the QR
 * TLV (lib/zatca/qr.ts) and the structure signDocument produces (lib/zatca/signing.ts).
 */
import { describe, expect, it } from "vitest";
import { generateEgsKeyPair, buildEgsCsr } from "@/lib/zatca/csr";
import { parseCertificate } from "@/lib/zatca/certificate";
import {
  astDate,
  astTime,
  buildUnsignedDocument,
  computeTotals,
  GENESIS_PREVIOUS_INVOICE_HASH,
  InvoiceInputError,
  type DocumentInput
} from "@/lib/zatca/invoice";
import { formatAmount, formatQuantity, parseDecimal, priceForLine, round2 } from "@/lib/zatca/money";
import { buildQrPayload, decodeQrPayload, decodeTlv, encodeTlv, QrTooLongError, qrTimestamp } from "@/lib/zatca/qr";
import { computeInvoiceHash, signDocument, verifyInvoiceSignature } from "@/lib/zatca/signing";
import { canonicalize, type XmlElement } from "@/lib/zatca/xml";
import { createHash } from "crypto";
import { issueTestCertificate, readCsr } from "../helpers/zatca-fakes";

const SELLER = {
  name: "بيت العود Bait Al Oud",
  vatNumber: "399999999900003",
  crNumber: "1010010000",
  address: { street: "King Fahd Rd", building: "1234", district: "Al Olaya", city: "Riyadh", postalCode: "12211" }
};
const BUYER = {
  name: "Fatoora Samples LTD",
  vatNumber: "399999999800003",
  address: { street: "Salah Al-Din", building: "1111", district: "Al-Murooj", city: "Riyadh", postalCode: "12222", countryCode: "SA" }
};
const base: DocumentInput = {
  invoiceType: "simplified",
  documentType: "invoice",
  invoiceNumber: "INV-1001",
  issuedAt: new Date("2026-06-01T21:30:00.000Z"), // 00:30 on 2 June in Riyadh
  icv: 1,
  previousInvoiceHash: GENESIS_PREVIOUS_INVOICE_HASH,
  seller: SELLER,
  buyer: { name: "محمد علي" },
  lines: [{ name: "Oud bottle", quantity: 2, unitPrice: 350, vatRate: 0.15 }]
};

const names = (el: XmlElement) => el.children.filter((c): c is XmlElement => typeof c !== "string").map((c) => c.name);
const textOf = (xml: string, tag: string) => new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml)?.[1];

describe("money", () => {
  it("rounds half-up exactly (no binary floating point)", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(formatAmount(10)).toBe("10.00");
    expect(formatAmount(parseDecimal("123.4949"))).toBe("123.49");
    expect(formatAmount(parseDecimal("123.4951"))).toBe("123.50");
    expect(formatQuantity(3)).toBe("3");
    expect(formatQuantity(0.5)).toBe("0.5");
  });

  it("prints the shortest unit price that reproduces the line net (BR-KSA-EN16931-11)", () => {
    expect(priceForLine(198.255, 4, parseDecimal("793.02"))).toBe("198.255");
    expect(priceForLine(100 / 3, 3, parseDecimal("100.00"))).toBe("33.333"); // 3 × 33.333 = 99.999 → 100.00
    expect(priceForLine(150, 2, parseDecimal("300.00"))).toBe("150.00");
  });
});

describe("computeTotals (ZATCA rounding)", () => {
  it("rounds VAT on the document level, not as a sum of rounded line VATs (XML standard §10)", () => {
    // three lines of 0.10: line VATs round to 0.02 each (0.06), the document VAT is 15% of 0.30 = 0.05 (0.045 → 0.05)
    const lines = [0, 1, 2].map((i) => ({ name: `L${i}`, quantity: 1, unitPrice: 0.1, vatRate: 0.15 }));
    expect(computeTotals(lines)).toEqual({ subtotal: 0.3, vat: 0.05, total: 0.35 });
    expect(computeTotals([{ name: "Oud", quantity: 2, unitPrice: 350, vatRate: 0.15 }, { name: "Bakhoor", quantity: 1, unitPrice: 120, vatRate: 0.15 }])).toEqual({
      subtotal: 820,
      vat: 123,
      total: 943
    });
  });
});

describe("buildUnsignedDocument", () => {
  it("follows the UBL 2.1 element order with ICV and PIH references", () => {
    const doc = buildUnsignedDocument(base);
    expect(names(doc.root)).toEqual([
      "cbc:ProfileID",
      "cbc:ID",
      "cbc:UUID",
      "cbc:IssueDate",
      "cbc:IssueTime",
      "cbc:InvoiceTypeCode",
      "cbc:DocumentCurrencyCode",
      "cbc:TaxCurrencyCode",
      "cac:AdditionalDocumentReference",
      "cac:AdditionalDocumentReference",
      "cac:AccountingSupplierParty",
      "cac:AccountingCustomerParty",
      "cac:PaymentMeans",
      "cac:TaxTotal",
      "cac:TaxTotal",
      "cac:LegalMonetaryTotal",
      "cac:InvoiceLine"
    ]);
    const xml = canonicalize(doc.root);
    expect(textOf(xml, "cbc:ProfileID")).toBe("reporting:1.0");
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain("<cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID>");
    expect(xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${GENESIS_PREVIOUS_INVOICE_HASH}</cbc:EmbeddedDocumentBinaryObject>`);
    // the genesis PIH is Base64 of the hex SHA-256 of "0" (BR-KSA-26)
    expect(Buffer.from(GENESIS_PREVIOUS_INVOICE_HASH, "base64").toString()).toBe(createHash("sha256").update("0").digest("hex"));
  });

  it("prints the issue date and time in Arabia Standard Time (BR-KSA-70)", () => {
    const doc = buildUnsignedDocument(base);
    expect(doc.issueDate).toBe("2026-06-02");
    expect(doc.issueTime).toBe("00:30:00");
    expect(astDate(new Date("2026-06-01T20:59:59Z"))).toBe("2026-06-01");
    expect(astTime(new Date("2026-06-01T20:59:59Z"))).toBe("23:59:59");
  });

  it("has two TaxTotal elements, line VAT/rounding amounts and the document totals", () => {
    const xml = canonicalize(buildUnsignedDocument(base).root);
    expect(xml).toContain('<cac:TaxTotal><cbc:TaxAmount currencyID="SAR">105.00</cbc:TaxAmount></cac:TaxTotal>');
    expect(xml).toContain('<cbc:TaxableAmount currencyID="SAR">700.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">105.00</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID><cbc:Percent>15.00</cbc:Percent>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">700.00</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">105.00</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">805.00</cbc:RoundingAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">805.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">805.00</cbc:PayableAmount>');
  });

  it("never contains an empty element (BR-KSA-F-03)", () => {
    const xml = canonicalize(buildUnsignedDocument({ ...base, invoiceType: "standard", buyer: BUYER }).root);
    expect(xml).not.toMatch(/<([a-z]+:[A-Za-z]+)[^>]*><\/\1>/);
  });

  it("standard invoices carry the buyer and the supply date; notes carry the billing reference and reason", () => {
    const std = canonicalize(buildUnsignedDocument({ ...base, invoiceType: "standard", buyer: BUYER, supplyDate: new Date("2026-05-31T09:00:00Z") }).root);
    expect(std).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(std).toContain("<cbc:CompanyID>399999999800003</cbc:CompanyID>");
    expect(std).toContain("<cac:Delivery><cbc:ActualDeliveryDate>2026-05-31</cbc:ActualDeliveryDate></cac:Delivery>");
    const credit = canonicalize(buildUnsignedDocument({ ...base, documentType: "credit_note", billingReference: "INV-1000", reason: "Returned goods" }).root);
    expect(credit).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(credit).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-1000</cbc:ID>");
    expect(credit).toContain("<cbc:InstructionNote>Returned goods</cbc:InstructionNote>");
    expect(canonicalize(buildUnsignedDocument({ ...base, documentType: "debit_note", billingReference: "INV-1000", reason: "Price change" }).root)).toContain(">383<");
  });

  it("refuses documents ZATCA would reject", () => {
    const bad = (patch: Partial<DocumentInput>) => () => buildUnsignedDocument({ ...base, ...patch });
    expect(bad({ seller: { ...SELLER, vatNumber: "12345" } })).toThrow(InvoiceInputError);
    expect(bad({ seller: { ...SELLER, address: { ...SELLER.address, building: "12" } } })).toThrow(/BR-KSA-37/);
    expect(bad({ seller: { ...SELLER, address: { ...SELLER.address, district: "" } } })).toThrow(/BR-KSA-09/);
    expect(bad({ invoiceType: "standard", buyer: { name: "No address" } })).toThrow(/BR-KSA-10/);
    expect(bad({ documentType: "credit_note" })).toThrow(/BR-KSA-56/);
    expect(bad({ lines: [{ name: "Exempt", quantity: 1, unitPrice: 10, vatRate: 0 }] })).toThrow(/exemption reason/);
    expect(bad({ lines: [] })).toThrow(/at least one line/);
  });
});

describe("QR TLV", () => {
  it("round-trips UTF-8 values and refuses values over 255 bytes", () => {
    const tlv = encodeTlv([{ tag: 1, value: "بيت العود" }, { tag: 2, value: "399999999900003" }]);
    expect(tlv[0]).toBe(1);
    expect(tlv[1]).toBe(Buffer.byteLength("بيت العود"));
    expect(decodeTlv(tlv).map((e) => e.value.toString())).toEqual(["بيت العود", "399999999900003"]);
    expect(() => encodeTlv([{ tag: 1, value: "ع".repeat(200) }])).toThrow(QrTooLongError);
  });

  it("forms tag 3 from IssueDate and IssueTime as printed (AST without zone, UTC keeps its Z)", () => {
    expect(qrTimestamp("2026-06-02", "00:30:00")).toBe("2026-06-02T00:30:00");
    expect(qrTimestamp("2026-06-01", "21:30:00Z")).toBe("2026-06-01T21:30:00Z");
  });

  it("puts tags 6–9 after the Phase-1 fields", () => {
    const qr = buildQrPayload({
      sellerName: "S",
      vatNumber: "399999999900003",
      issueDate: "2026-06-02",
      issueTime: "00:30:00",
      totalWithVat: "805.00",
      vatTotal: "105.00",
      invoiceHash: "aGFzaA==",
      signatureValue: "c2ln",
      publicKey: Buffer.from([1, 2, 3]),
      certificateSignature: Buffer.from([4, 5])
    });
    expect(decodeQrPayload(qr)).toMatchObject({ tags: [1, 2, 3, 4, 5, 6, 7, 8, 9], totalWithVat: "805.00", vatTotal: "105.00", invoiceHash: "aGFzaA==" });
  });
});

describe("signDocument", () => {
  const keys = generateEgsKeyPair();
  const csr = buildEgsCsr(
    {
      environment: "sandbox",
      commonName: "t",
      organizationName: "o",
      organizationUnit: "u",
      egsSerialNumber: "1-a|2-b|3-c",
      vatNumber: "399999999900003",
      invoiceTypes: "1100",
      location: "l",
      industry: "i"
    },
    keys.privateKey
  );
  const { spki, subject } = readCsr(csr.pem);
  const certificate = parseCertificate(issueTestCertificate({ spki, subject }).toString("base64"));
  const sign = (doc: ReturnType<typeof buildUnsignedDocument>, simplified: boolean) =>
    signDocument(doc, { privateKey: keys.privateKey, certificate, sellerName: SELLER.name, vatNumber: SELLER.vatNumber, simplified, signedAt: new Date("2026-06-01T21:31:00Z") });

  it("adds UBLExtensions first, then the QR reference and cac:Signature after PIH, without changing the hash", () => {
    const unsigned = buildUnsignedDocument(base);
    const signed = sign(unsigned, true);
    const order = names(signed.root);
    expect(order[0]).toBe("ext:UBLExtensions");
    expect(order.slice(9, 13)).toEqual(["cac:AdditionalDocumentReference", "cac:AdditionalDocumentReference", "cac:AdditionalDocumentReference", "cac:Signature"]);
    expect(signed.invoiceHash).toBe(computeInvoiceHash(unsigned.root));
    expect(verifyInvoiceSignature(signed.invoiceHash, signed.signatureValue, certificate.publicKey)).toBe(true);
    expect(signed.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice')).toBe(true);
    expect(signed.xml).toContain("<xades:SigningTime>2026-06-01T21:31:00Z</xades:SigningTime>");
    expect(signed.xml).toContain('<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>');
    expect(signed.xml).toContain(`<ds:X509IssuerName>${certificate.issuerName}</ds:X509IssuerName>`);
  });

  it("QR tag 9 (the CA's certificate signature) only on simplified documents", () => {
    const simplified = decodeQrPayload(sign(buildUnsignedDocument(base), true).qr);
    expect(simplified.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(simplified.certificateSignature?.equals(certificate.signature)).toBe(true);
    expect(simplified.timestamp).toBe("2026-06-02T00:30:00");
    const standard = decodeQrPayload(sign(buildUnsignedDocument({ ...base, invoiceType: "standard", buyer: BUYER }), false).qr);
    expect(standard.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
