/**
 * ZATCA Phase 2 e-invoice generator.
 *
 * Produces:
 *   - A UUID (per-invoice GUID, mandated)
 *   - A TLV-encoded base64 QR string (mandatory on every B2C invoice)
 *   - A signed XML invoice ready for ZATCA Fatoora submission (B2B clearance flow)
 *
 * This module covers the deterministic parts. The cryptographic signing and live Fatoora
 * submission live in a separate module (`./fatoora.ts`) because they require the merchant's
 * onboarded CSID (Cryptographic Stamp ID), which we obtain via the ZATCA onboarding API.
 *
 * Reference: ZATCA E-Invoicing Detailed Guideline (v3.x) — see /docs/zatca-spec.md
 */
import { create as createXML } from "xmlbuilder2";
import { randomUUID, createHash } from "crypto";

export type InvoiceLine = {
  /** Free-text item description as shown to buyer */
  name: string;
  quantity: number;
  /** Unit price BEFORE VAT, in SAR */
  unitPrice: number;
  /** VAT rate as fraction — 0.15 for standard KSA rate */
  vatRate: number;
};

export type SellerInfo = {
  name: string;
  /** 15-digit VAT registration number */
  vatNumber: string;
  /** 10-digit Commercial Registration number */
  crNumber?: string;
  address: { street: string; building: string; city: string; postalCode: string; district?: string };
};

export type BuyerInfo = {
  name: string;
  vatNumber?: string; // required for B2B (standard) invoices
};

export type InvoiceInput = {
  invoiceNumber: string; // sequential, gap-free (ZATCA requirement)
  issueDate: Date;
  seller: SellerInfo;
  buyer?: BuyerInfo; // undefined → B2C simplified invoice
  lines: InvoiceLine[];
  /** Optional reference to the previous invoice's hash for the chained-hash ICV (Invoice Counter Value) */
  previousInvoiceHash?: string;
  /** Sequential counter, incremented per invoice from this seller's CSID */
  icv: number;
};

export type InvoiceTotals = {
  subtotal: number;
  vat: number;
  total: number;
};

export type GeneratedInvoice = {
  uuid: string;
  invoiceNumber: string;
  totals: InvoiceTotals;
  qrBase64: string;
  xml: string;
  /** SHA-256 of the canonical XML — feeds the next invoice's previousInvoiceHash */
  invoiceHash: string;
};

// ── TOTALS ─────────────────────────────────────────────────────────────────
export function computeTotals(lines: InvoiceLine[]): InvoiceTotals {
  let subtotal = 0;
  let vat = 0;
  for (const line of lines) {
    const lineNet = round2(line.unitPrice * line.quantity);
    const lineVat = round2(lineNet * line.vatRate);
    subtotal += lineNet;
    vat += lineVat;
  }
  subtotal = round2(subtotal);
  vat = round2(vat);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── TLV QR ENCODING ────────────────────────────────────────────────────────
/**
 * ZATCA mandated QR: Base64( TLV(seller, vatNumber, isoTimestamp, totalWithVAT, vat) )
 * Tag values 1..5 per ZATCA spec. For Phase 2, the QR additionally includes
 * tags 6..9 (XML hash, ECDSA signature, public key, signature of public key)
 * once the CSID is in play. This function emits the Phase-1-shape QR (tags 1..5)
 * which remains valid as the mandatory subset.
 */
export function buildQRBase64(input: {
  sellerName: string;
  vatNumber: string;
  issuedAtISO: string;
  total: number;
  vat: number;
}): string {
  const tlv = Buffer.concat([
    tlv1(1, input.sellerName),
    tlv1(2, input.vatNumber),
    tlv1(3, input.issuedAtISO),
    tlv1(4, input.total.toFixed(2)),
    tlv1(5, input.vat.toFixed(2))
  ]);
  return tlv.toString("base64");
}

function tlv1(tag: number, value: string): Buffer {
  const valueBuf = Buffer.from(value, "utf8");
  if (valueBuf.length > 0xff) throw new Error(`TLV tag ${tag} value too long (>255 bytes)`);
  return Buffer.concat([Buffer.from([tag]), Buffer.from([valueBuf.length]), valueBuf]);
}

// ── UBL 2.1 INVOICE XML ────────────────────────────────────────────────────
/**
 * Emits a UBL 2.1 conformant XML invoice. ZATCA uses an extended UBL schema (CBC/CAC namespaces).
 * This implementation covers the required-for-clearance fields. For full clearance you must
 * additionally sign with the CSID-derived private key — see `./fatoora.ts`.
 */
export function buildInvoiceXML(input: InvoiceInput, uuid: string, totals: InvoiceTotals): string {
  const isB2B = !!input.buyer?.vatNumber;
  const invoiceTypeCode = isB2B ? "388" : "388"; // 388 = standard tax invoice. Simplified uses 388 too in UBL but with subtype.
  const doc = createXML({ version: "1.0", encoding: "UTF-8" })
    .ele("Invoice", {
      xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
      "xmlns:ext": "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
    });

  doc.ele("cbc:ProfileID").txt("reporting:1.0").up();
  doc.ele("cbc:ID").txt(input.invoiceNumber).up();
  doc.ele("cbc:UUID").txt(uuid).up();
  doc.ele("cbc:IssueDate").txt(formatDate(input.issueDate)).up();
  doc.ele("cbc:IssueTime").txt(formatTime(input.issueDate)).up();
  doc.ele("cbc:InvoiceTypeCode", { name: isB2B ? "0100000" : "0200000" }).txt(invoiceTypeCode).up();
  doc.ele("cbc:DocumentCurrencyCode").txt("SAR").up();
  doc.ele("cbc:TaxCurrencyCode").txt("SAR").up();

  // ICV (Invoice Counter Value) + PIH (Previous Invoice Hash)
  const ai = doc.ele("cac:AdditionalDocumentReference");
  ai.ele("cbc:ID").txt("ICV").up();
  ai.ele("cbc:UUID").txt(String(input.icv)).up();
  ai.up();

  if (input.previousInvoiceHash) {
    const pih = doc.ele("cac:AdditionalDocumentReference");
    pih.ele("cbc:ID").txt("PIH").up();
    const att = pih.ele("cac:Attachment");
    att.ele("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }).txt(input.previousInvoiceHash).up();
    att.up(); pih.up();
  }

  // Seller
  const supplier = doc.ele("cac:AccountingSupplierParty").ele("cac:Party");
  const sId = supplier.ele("cac:PartyIdentification");
  sId.ele("cbc:ID", { schemeID: "CRN" }).txt(input.seller.crNumber ?? "0000000000").up();
  sId.up();
  const sAddr = supplier.ele("cac:PostalAddress");
  sAddr.ele("cbc:StreetName").txt(input.seller.address.street).up();
  sAddr.ele("cbc:BuildingNumber").txt(input.seller.address.building).up();
  sAddr.ele("cbc:CityName").txt(input.seller.address.city).up();
  sAddr.ele("cbc:PostalZone").txt(input.seller.address.postalCode).up();
  if (input.seller.address.district) sAddr.ele("cbc:CitySubdivisionName").txt(input.seller.address.district).up();
  sAddr.ele("cac:Country").ele("cbc:IdentificationCode").txt("SA").up().up();
  sAddr.up();
  const sTax = supplier.ele("cac:PartyTaxScheme");
  sTax.ele("cbc:CompanyID").txt(input.seller.vatNumber).up();
  sTax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
  sTax.up();
  supplier.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(input.seller.name).up().up();
  supplier.up().up();

  // Buyer (if B2B)
  if (input.buyer) {
    const customer = doc.ele("cac:AccountingCustomerParty").ele("cac:Party");
    if (input.buyer.vatNumber) {
      const cTax = customer.ele("cac:PartyTaxScheme");
      cTax.ele("cbc:CompanyID").txt(input.buyer.vatNumber).up();
      cTax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
      cTax.up();
    }
    customer.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(input.buyer.name).up().up();
    customer.up().up();
  }

  // Lines
  let lineIdx = 1;
  for (const line of input.lines) {
    const net = round2(line.unitPrice * line.quantity);
    const vat = round2(net * line.vatRate);
    const il = doc.ele("cac:InvoiceLine");
    il.ele("cbc:ID").txt(String(lineIdx++)).up();
    il.ele("cbc:InvoicedQuantity", { unitCode: "PCE" }).txt(line.quantity.toString()).up();
    il.ele("cbc:LineExtensionAmount", { currencyID: "SAR" }).txt(net.toFixed(2)).up();
    const txTotal = il.ele("cac:TaxTotal");
    txTotal.ele("cbc:TaxAmount", { currencyID: "SAR" }).txt(vat.toFixed(2)).up();
    txTotal.ele("cbc:RoundingAmount", { currencyID: "SAR" }).txt((net + vat).toFixed(2)).up();
    txTotal.up();
    const item = il.ele("cac:Item");
    item.ele("cbc:Name").txt(line.name).up();
    const ct = item.ele("cac:ClassifiedTaxCategory");
    ct.ele("cbc:ID").txt("S").up();
    ct.ele("cbc:Percent").txt((line.vatRate * 100).toFixed(2)).up();
    ct.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    ct.up();
    item.up();
    const price = il.ele("cac:Price");
    price.ele("cbc:PriceAmount", { currencyID: "SAR" }).txt(line.unitPrice.toFixed(2)).up();
    price.up();
    il.up();
  }

  // Totals
  const tot = doc.ele("cac:TaxTotal");
  tot.ele("cbc:TaxAmount", { currencyID: "SAR" }).txt(totals.vat.toFixed(2)).up();
  tot.up();
  const lm = doc.ele("cac:LegalMonetaryTotal");
  lm.ele("cbc:LineExtensionAmount", { currencyID: "SAR" }).txt(totals.subtotal.toFixed(2)).up();
  lm.ele("cbc:TaxExclusiveAmount", { currencyID: "SAR" }).txt(totals.subtotal.toFixed(2)).up();
  lm.ele("cbc:TaxInclusiveAmount", { currencyID: "SAR" }).txt(totals.total.toFixed(2)).up();
  lm.ele("cbc:PayableAmount", { currencyID: "SAR" }).txt(totals.total.toFixed(2)).up();
  lm.up();

  return doc.end({ prettyPrint: false });
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatTime(d: Date): string {
  return d.toISOString().slice(11, 19);
}

// ── PUBLIC API ─────────────────────────────────────────────────────────────
export function generateInvoice(input: InvoiceInput): GeneratedInvoice {
  if (!/^\d{15}$/.test(input.seller.vatNumber)) {
    throw new Error("Seller VAT number must be 15 digits per ZATCA.");
  }
  const totals = computeTotals(input.lines);
  const uuid = randomUUID();
  const qrBase64 = buildQRBase64({
    sellerName: input.seller.name,
    vatNumber: input.seller.vatNumber,
    issuedAtISO: input.issueDate.toISOString(),
    total: totals.total,
    vat: totals.vat
  });
  const xml = buildInvoiceXML(input, uuid, totals);
  const invoiceHash = createHash("sha256").update(xml, "utf8").digest("base64");
  return { uuid, invoiceNumber: input.invoiceNumber, totals, qrBase64, xml, invoiceHash };
}
