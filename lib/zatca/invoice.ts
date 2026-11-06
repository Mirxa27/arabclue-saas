/**
 * ZATCA Phase-2 UBL 2.1 documents: standard (B2B, cleared) and simplified (B2C, reported) tax
 * invoices, credit notes (381) and debit notes (383).
 *
 * This module builds the *unsigned* document tree and its totals; lib/zatca/signing.ts adds the
 * XAdES signature (ext:UBLExtensions), the QR code and cac:Signature. Rules implemented
 * (data/research/zatca-phase2.md, XML Implementation Standard v1.2):
 *   - element order of the UBL 2.1 Invoice schema; ProfileID reporting:1.0; InvoiceTypeCode
 *     388/381/383 with @name 0100000 (standard) / 0200000 (simplified) (§11.2.1, BR-KSA-06)
 *   - ICV (KSA-16) and PIH (KSA-13) AdditionalDocumentReferences (BR-KSA-26/33/61)
 *   - IssueDate / IssueTime in Arabia Standard Time, hh:mm:ss (BR-KSA-70)
 *   - line net = round(qty × price), line VAT = round(net × rate), RoundingAmount = net + VAT
 *     (BR-KSA-51, BR-KSA-EN16931-11); VAT breakdown rounded on document level, half-up (§9, §10)
 *   - two cac:TaxTotal: one in SAR without subtotals, one with the breakdown (BR-KSA-EN16931-08/09)
 *   - standard documents: buyer name + address (BR-KSA-42/10/63) and supply date (BR-KSA-15);
 *     credit/debit notes: BillingReference (BR-KSA-56) and the reason in InstructionNote (BR-KSA-17)
 */
import { randomUUID } from "crypto";
import { el, type XmlElement } from "@/lib/zatca/xml";
import {
  addDecimal,
  decimalFromNumber,
  decimalToNumber,
  formatAmount,
  formatQuantity,
  multiplyDecimal,
  priceForLine,
  roundDecimal,
  type Decimal,
  ZERO
} from "@/lib/zatca/money";

export const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sig: "urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2",
  sac: "urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2",
  sbc: "urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xades: "http://uri.etsi.org/01903/v1.3.2#"
} as const;

/** PIH of an EGS unit's first document: Base64 of the hex SHA-256 of "0" (BR-KSA-26). */
export const GENESIS_PREVIOUS_INVOICE_HASH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/** KSA standard VAT rate. */
export const KSA_STANDARD_VAT_RATE = 0.15;

// ── input types ────────────────────────────────────────────────────────────

export type VatCategory = "S" | "Z" | "E" | "O";

export type InvoiceLine = {
  /** Free-text item description as shown to the buyer. */
  name: string;
  quantity: number;
  /** Unit price BEFORE VAT, in SAR (may carry more than two decimals). */
  unitPrice: number;
  /** VAT rate as a fraction — 0.15 for the KSA standard rate. */
  vatRate: number;
  /** Defaults to S for a positive rate. Z/E/O need an exemption reason (BR-KSA-CL-04). */
  vatCategory?: VatCategory;
  exemptionReasonCode?: string;
  exemptionReason?: string;
};

export type SellerAddressInput = {
  street: string;
  building: string;
  city: string;
  postalCode: string;
  district?: string;
  /** Optional additional street name. */
  additionalStreet?: string;
};

export type SellerInfo = {
  name: string;
  /** 15-digit VAT registration number (first and last digit 3). */
  vatNumber: string;
  /** 10-digit Commercial Registration number (PartyIdentification schemeID CRN). */
  crNumber?: string;
  address: SellerAddressInput;
};

export type BuyerAddress = {
  street: string;
  building?: string;
  district?: string;
  city: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2, default SA. */
  countryCode?: string;
};

export type BuyerIdScheme = "TIN" | "CRN" | "MOM" | "MLS" | "700" | "SAG" | "NAT" | "GCC" | "IQA" | "PAS" | "OTH";

export type BuyerInfo = {
  name: string;
  /** Buyer VAT number — present ⇒ standard (B2B) invoice. */
  vatNumber?: string;
  address?: BuyerAddress;
  /** Other buyer id for a standard invoice to a buyer without a VAT number (BR-KSA-14/81). */
  otherId?: { scheme: BuyerIdScheme; value: string };
};

export type ZatcaInvoiceType = "standard" | "simplified";
export type ZatcaDocumentType = "invoice" | "credit_note" | "debit_note";

export const DOCUMENT_TYPE_CODES: Record<ZatcaDocumentType, string> = {
  invoice: "388",
  debit_note: "383",
  credit_note: "381"
};

export type DocumentInput = {
  invoiceType: ZatcaInvoiceType;
  documentType: ZatcaDocumentType;
  /** BT-1 — the invoice number shown to the buyer. */
  invoiceNumber: string;
  /** KSA-1 — defaults to a fresh v4 UUID. */
  uuid?: string;
  /** The issue instant; printed as AST (UTC+3) date and time. */
  issuedAt: Date;
  /** KSA-16 invoice counter value. */
  icv: number;
  /** KSA-13 hash of the previously generated document (GENESIS_PREVIOUS_INVOICE_HASH for the first). */
  previousInvoiceHash: string;
  seller: SellerInfo;
  buyer?: BuyerInfo;
  lines: InvoiceLine[];
  /** KSA-5 supply date — required for standard invoices; defaults to the issue date. */
  supplyDate?: Date;
  /** UNTDID 4461: "10" cash, "30" credit transfer, "42" bank account, "48" bank card, "1" not defined. */
  paymentMeansCode?: string;
  /** Credit/debit notes: the original invoice number (BT-25) and the reason (KSA-10). */
  billingReference?: string;
  reason?: string;
  note?: string;
};

// ── dates (Arabia Standard Time, no DST) ───────────────────────────────────

const AST_OFFSET_MS = 3 * 60 * 60 * 1000;

export function astDate(d: Date): string {
  return new Date(d.getTime() + AST_OFFSET_MS).toISOString().slice(0, 10);
}

export function astTime(d: Date): string {
  return new Date(d.getTime() + AST_OFFSET_MS).toISOString().slice(11, 19);
}

/** "2026-11-06T10:15:30" in AST — xades:SigningTime. */
export function astDateTime(d: Date): string {
  return `${astDate(d)}T${astTime(d)}`;
}

// ── totals ─────────────────────────────────────────────────────────────────

export type VatBreakdownEntry = {
  category: VatCategory;
  /** Percent as printed, e.g. "15.00". */
  percent: string;
  taxable: Decimal;
  tax: Decimal;
  exemptionReasonCode?: string;
  exemptionReason?: string;
};

export type LineTotals = { net: Decimal; vat: Decimal; withVat: Decimal; price: string };

export type DocumentTotals = {
  lines: LineTotals[];
  breakdown: VatBreakdownEntry[];
  lineExtension: Decimal;
  taxExclusive: Decimal;
  vat: Decimal;
  taxInclusive: Decimal;
  payable: Decimal;
};

export type InvoiceTotals = { subtotal: number; vat: number; total: number };

function lineCategory(line: InvoiceLine): VatCategory {
  return line.vatCategory ?? (line.vatRate > 0 ? "S" : "Z");
}

function percentOf(rate: number): string {
  return formatAmount(roundDecimal(multiplyDecimal(decimalFromNumber(rate), { units: 100n, scale: 0 }), 2));
}

export class InvoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceInputError";
  }
}

function validateLineAmounts(line: InvoiceLine, index: number) {
  if (!(line.quantity > 0) || !Number.isFinite(line.quantity)) throw new InvoiceInputError(`line ${index + 1}: quantity must be positive`);
  if (!(line.unitPrice >= 0) || !Number.isFinite(line.unitPrice)) throw new InvoiceInputError(`line ${index + 1}: price must be zero or positive`);
  if (!(line.vatRate >= 0 && line.vatRate <= 1)) throw new InvoiceInputError(`line ${index + 1}: VAT rate must be a fraction`);
}

/** ZATCA rules for one document line: a name, and a category consistent with its rate (BR-KSA-CL-04). */
function validateLine(line: InvoiceLine, index: number) {
  validateLineAmounts(line, index);
  if (!line.name || !line.name.trim()) throw new InvoiceInputError(`line ${index + 1}: name is required`);
  const category = lineCategory(line);
  if (category === "S" && !(line.vatRate > 0)) throw new InvoiceInputError(`line ${index + 1}: standard-rated lines need a positive rate`);
  if (category !== "S") {
    if (line.vatRate !== 0) throw new InvoiceInputError(`line ${index + 1}: category ${category} must have a 0% rate`);
    if (!line.exemptionReasonCode || !line.exemptionReason) {
      throw new InvoiceInputError(`line ${index + 1}: category ${category} needs an exemption reason code and text`);
    }
  }
}

/** ZATCA totals: per-line rounding for line amounts, document-level rounding for VAT (§9, §10). */
export function computeDocumentTotals(lines: InvoiceLine[]): DocumentTotals {
  if (lines.length === 0) throw new InvoiceInputError("an invoice needs at least one line");
  lines.forEach(validateLineAmounts);
  const lineTotals: LineTotals[] = lines.map((line) => {
    const net = roundDecimal(multiplyDecimal(decimalFromNumber(line.unitPrice), decimalFromNumber(Number(formatQuantity(line.quantity)))), 2);
    const vat = roundDecimal(multiplyDecimal(net, decimalFromNumber(line.vatRate)), 2);
    return { net, vat, withVat: addDecimal(net, vat), price: priceForLine(line.unitPrice, line.quantity, net) };
  });

  const groups = new Map<string, VatBreakdownEntry & { rate: number }>();
  lines.forEach((line, i) => {
    const category = lineCategory(line);
    const percent = percentOf(line.vatRate);
    const key = `${category}|${percent}|${line.exemptionReasonCode ?? ""}`;
    const group = groups.get(key) ?? {
      category,
      percent,
      rate: line.vatRate,
      taxable: ZERO,
      tax: ZERO,
      exemptionReasonCode: line.exemptionReasonCode,
      exemptionReason: line.exemptionReason
    };
    group.taxable = addDecimal(group.taxable, lineTotals[i].net);
    groups.set(key, group);
  });
  const breakdown: VatBreakdownEntry[] = [...groups.values()].map(({ rate, ...g }) => ({
    ...g,
    tax: roundDecimal(multiplyDecimal(g.taxable, decimalFromNumber(rate)), 2)
  }));

  const lineExtension = lineTotals.reduce((s, l) => addDecimal(s, l.net), ZERO);
  const vat = breakdown.reduce((s, g) => addDecimal(s, g.tax), ZERO);
  const taxInclusive = addDecimal(lineExtension, vat);
  return { lines: lineTotals, breakdown, lineExtension, taxExclusive: lineExtension, vat, taxInclusive, payable: taxInclusive };
}

/** The document's subtotal (BT-109), VAT (BT-110) and total (BT-112) as numbers. */
export function computeTotals(lines: InvoiceLine[]): InvoiceTotals {
  const t = computeDocumentTotals(lines);
  return { subtotal: decimalToNumber(t.lineExtension), vat: decimalToNumber(t.vat), total: decimalToNumber(t.taxInclusive) };
}

// ── document ───────────────────────────────────────────────────────────────

const amount = (name: string, value: Decimal) => el(name, { currencyID: "SAR" }, formatAmount(value));

function trimmed(value: string | undefined | null, max: number): string | undefined {
  const v = value?.trim();
  return v ? [...v].slice(0, max).join("") : undefined;
}

function sellerParty(seller: SellerInfo): XmlElement {
  const a = seller.address;
  return el(
    "cac:AccountingSupplierParty",
    null,
    el(
      "cac:Party",
      null,
      trimmed(seller.crNumber, 10) ? el("cac:PartyIdentification", null, el("cbc:ID", { schemeID: "CRN" }, trimmed(seller.crNumber, 10))) : null,
      el(
        "cac:PostalAddress",
        null,
        el("cbc:StreetName", null, trimmed(a.street, 127)),
        trimmed(a.additionalStreet, 127) ? el("cbc:AdditionalStreetName", null, trimmed(a.additionalStreet, 127)) : null,
        el("cbc:BuildingNumber", null, trimmed(a.building, 4)),
        trimmed(a.district, 127) ? el("cbc:CitySubdivisionName", null, trimmed(a.district, 127)) : null,
        el("cbc:CityName", null, trimmed(a.city, 127)),
        el("cbc:PostalZone", null, trimmed(a.postalCode, 5)),
        el("cac:Country", null, el("cbc:IdentificationCode", null, "SA"))
      ),
      el("cac:PartyTaxScheme", null, el("cbc:CompanyID", null, seller.vatNumber), el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))),
      el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, trimmed(seller.name, 1000)))
    )
  );
}

function buyerParty(buyer: BuyerInfo | undefined): XmlElement {
  const a = buyer?.address;
  const children = [
    buyer?.otherId && !buyer.vatNumber
      ? el("cac:PartyIdentification", null, el("cbc:ID", { schemeID: buyer.otherId.scheme }, trimmed(buyer.otherId.value, 50)))
      : null,
    a
      ? el(
          "cac:PostalAddress",
          null,
          el("cbc:StreetName", null, trimmed(a.street, 127)),
          trimmed(a.building, 4) ? el("cbc:BuildingNumber", null, trimmed(a.building, 4)) : null,
          trimmed(a.district, 127) ? el("cbc:CitySubdivisionName", null, trimmed(a.district, 127)) : null,
          el("cbc:CityName", null, trimmed(a.city, 127)),
          trimmed(a.postalCode, 10) ? el("cbc:PostalZone", null, trimmed(a.postalCode, 10)) : null,
          el("cac:Country", null, el("cbc:IdentificationCode", null, (a.countryCode ?? "SA").toUpperCase()))
        )
      : null,
    buyer?.vatNumber
      ? el("cac:PartyTaxScheme", null, el("cbc:CompanyID", null, buyer.vatNumber), el("cac:TaxScheme", null, el("cbc:ID", null, "VAT")))
      : null,
    trimmed(buyer?.name, 1000) ? el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, trimmed(buyer?.name, 1000))) : null
  ].filter(Boolean);
  return el("cac:AccountingCustomerParty", null, el("cac:Party", null, children));
}

function taxCategory(name: "cac:TaxCategory" | "cac:ClassifiedTaxCategory", g: { category: VatCategory; percent: string; exemptionReasonCode?: string; exemptionReason?: string }, withScheme: boolean) {
  const idAttrs = withScheme ? { schemeAgencyID: "6", schemeID: "UN/ECE 5305" } : null;
  const schemeAttrs = withScheme ? { schemeAgencyID: "6", schemeID: "UN/ECE 5153" } : null;
  return el(
    name,
    null,
    el("cbc:ID", idAttrs, g.category),
    el("cbc:Percent", null, g.percent),
    name === "cac:TaxCategory" && g.exemptionReasonCode ? el("cbc:TaxExemptionReasonCode", null, g.exemptionReasonCode) : null,
    name === "cac:TaxCategory" && g.exemptionReason ? el("cbc:TaxExemptionReason", null, trimmed(g.exemptionReason, 1000)) : null,
    el("cac:TaxScheme", null, el("cbc:ID", schemeAttrs, "VAT"))
  );
}

export type UnsignedDocument = {
  root: XmlElement;
  uuid: string;
  issueDate: string;
  issueTime: string;
  totals: DocumentTotals;
};

export function validateDocumentInput(input: DocumentInput): void {
  if (!/^3\d{13}3$/.test(input.seller.vatNumber)) throw new InvoiceInputError("Seller VAT number must be 15 digits starting and ending with 3.");
  if (!input.invoiceNumber.trim() || input.invoiceNumber.length > 127) throw new InvoiceInputError("invoice number is required (max 127 characters)");
  if (!Number.isInteger(input.icv) || input.icv < 1) throw new InvoiceInputError("ICV must be a positive integer");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.previousInvoiceHash)) throw new InvoiceInputError("previous invoice hash must be Base64");
  if (Number.isNaN(input.issuedAt.getTime())) throw new InvoiceInputError("issue date is invalid");
  const a = input.seller.address;
  if (!a.street?.trim() || !a.city?.trim()) throw new InvoiceInputError("seller street and city are required");
  if (!/^\d{4}$/.test(a.building ?? "")) throw new InvoiceInputError("seller building number must be 4 digits (BR-KSA-37)");
  if (!/^\d{5}$/.test(a.postalCode ?? "")) throw new InvoiceInputError("seller postal code must be 5 digits (BR-KSA-66)");
  if (!a.district?.trim()) throw new InvoiceInputError("seller district is required (BR-KSA-09)");
  if (input.invoiceType === "standard") {
    const b = input.buyer;
    if (!b?.name?.trim()) throw new InvoiceInputError("standard invoices need the buyer name (BR-KSA-42)");
    if (!b.address?.street?.trim() || !b.address.city?.trim()) throw new InvoiceInputError("standard invoices need the buyer street and city (BR-KSA-10)");
    if (b.vatNumber && !/^3\d{13}3$/.test(b.vatNumber)) throw new InvoiceInputError("buyer VAT number must be 15 digits starting and ending with 3");
    if (!b.vatNumber && !b.otherId) throw new InvoiceInputError("standard invoices need the buyer VAT number or another buyer id (BR-KSA-14)");
    if ((b.address.countryCode ?? "SA").toUpperCase() === "SA") {
      if (!/^\d{4}$/.test(b.address.building ?? "")) throw new InvoiceInputError("buyer building number must be 4 digits (BR-KSA-63)");
      if (!/^\d{5}$/.test(b.address.postalCode ?? "")) throw new InvoiceInputError("buyer postal code must be 5 digits (BR-KSA-67)");
      if (!b.address.district?.trim()) throw new InvoiceInputError("buyer district is required (BR-KSA-63)");
    }
  }
  if (input.documentType !== "invoice") {
    if (!input.billingReference?.trim()) throw new InvoiceInputError("credit and debit notes need the original invoice number (BR-KSA-56)");
    if (!input.reason?.trim()) throw new InvoiceInputError("credit and debit notes need a reason (BR-KSA-17)");
  }
}

/** The unsigned UBL document (no ext:UBLExtensions, QR or cac:Signature yet). */
export function buildUnsignedDocument(input: DocumentInput): UnsignedDocument {
  validateDocumentInput(input);
  if (input.lines.length === 0) throw new InvoiceInputError("an invoice needs at least one line");
  input.lines.forEach(validateLine);
  const totals = computeDocumentTotals(input.lines);
  const uuid = input.uuid ?? randomUUID();
  const issueDate = astDate(input.issuedAt);
  const issueTime = astTime(input.issuedAt);
  const subtype = input.invoiceType === "standard" ? "0100000" : "0200000";
  const isNote = input.documentType !== "invoice";
  const supplyDate = input.supplyDate ? astDate(input.supplyDate) : issueDate;

  const root = el(
    "Invoice",
    { xmlns: NS.invoice, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc, "xmlns:ext": NS.ext },
    el("cbc:ProfileID", null, "reporting:1.0"),
    el("cbc:ID", null, input.invoiceNumber.trim()),
    el("cbc:UUID", null, uuid),
    el("cbc:IssueDate", null, issueDate),
    el("cbc:IssueTime", null, issueTime),
    el("cbc:InvoiceTypeCode", { name: subtype }, DOCUMENT_TYPE_CODES[input.documentType]),
    trimmed(input.note, 1000) ? el("cbc:Note", null, trimmed(input.note, 1000)) : null,
    el("cbc:DocumentCurrencyCode", null, "SAR"),
    el("cbc:TaxCurrencyCode", null, "SAR"),
    isNote
      ? el("cac:BillingReference", null, el("cac:InvoiceDocumentReference", null, el("cbc:ID", null, trimmed(input.billingReference, 127))))
      : null,
    el("cac:AdditionalDocumentReference", null, el("cbc:ID", null, "ICV"), el("cbc:UUID", null, String(input.icv))),
    el(
      "cac:AdditionalDocumentReference",
      null,
      el("cbc:ID", null, "PIH"),
      el("cac:Attachment", null, el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, input.previousInvoiceHash))
    ),
    sellerParty(input.seller),
    buyerParty(input.buyer),
    input.invoiceType === "standard" ? el("cac:Delivery", null, el("cbc:ActualDeliveryDate", null, supplyDate)) : null,
    el(
      "cac:PaymentMeans",
      null,
      el("cbc:PaymentMeansCode", null, input.paymentMeansCode ?? "10"),
      isNote ? el("cbc:InstructionNote", null, trimmed(input.reason, 1000)) : null
    ),
    el("cac:TaxTotal", null, amount("cbc:TaxAmount", totals.vat)),
    el(
      "cac:TaxTotal",
      null,
      amount("cbc:TaxAmount", totals.vat),
      totals.breakdown.map((g) =>
        el("cac:TaxSubtotal", null, amount("cbc:TaxableAmount", g.taxable), amount("cbc:TaxAmount", g.tax), taxCategory("cac:TaxCategory", g, true))
      )
    ),
    el(
      "cac:LegalMonetaryTotal",
      null,
      amount("cbc:LineExtensionAmount", totals.lineExtension),
      amount("cbc:TaxExclusiveAmount", totals.taxExclusive),
      amount("cbc:TaxInclusiveAmount", totals.taxInclusive),
      amount("cbc:AllowanceTotalAmount", ZERO),
      amount("cbc:PrepaidAmount", ZERO),
      amount("cbc:PayableAmount", totals.payable)
    ),
    input.lines.map((line, i) => {
      const t = totals.lines[i];
      const category = lineCategory(line);
      return el(
        "cac:InvoiceLine",
        null,
        el("cbc:ID", null, String(i + 1)),
        el("cbc:InvoicedQuantity", { unitCode: "PCE" }, formatQuantity(line.quantity)),
        amount("cbc:LineExtensionAmount", t.net),
        el("cac:TaxTotal", null, amount("cbc:TaxAmount", t.vat), amount("cbc:RoundingAmount", t.withVat)),
        el("cac:Item", null, el("cbc:Name", null, trimmed(line.name, 1000)), taxCategory("cac:ClassifiedTaxCategory", { category, percent: percentOf(line.vatRate) }, false)),
        el("cac:Price", null, el("cbc:PriceAmount", { currencyID: "SAR" }, t.price))
      );
    })
  );
  return { root, uuid, issueDate, issueTime, totals };
}
