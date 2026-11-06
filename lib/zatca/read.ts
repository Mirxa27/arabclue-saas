/**
 * Read the human-facing content of a stored UBL invoice — ours, or the ZATCA-stamped cleared one —
 * for the invoice page, the printable view and exports. Parsing is lenient about whitespace and
 * returns nulls for fields a document does not carry (e.g. invoices issued before Phase 2).
 */
import { parseXml, XmlParseError } from "@/lib/zatca/xml-parse";
import { findChild, textOf, type XmlElement } from "@/lib/zatca/xml";

export type ReadLine = {
  name: string;
  quantity: string;
  unitPrice: string | null;
  net: string;
  vat: string | null;
  withVat: string | null;
  vatPercent: string | null;
  category: string | null;
};

export type ReadParty = {
  name: string | null;
  vatNumber: string | null;
  otherId: { scheme: string | null; value: string } | null;
  address: { street: string | null; building: string | null; district: string | null; city: string | null; postalCode: string | null; country: string | null } | null;
};

export type ReadInvoice = {
  invoiceNumber: string | null;
  uuid: string | null;
  issueDate: string | null;
  issueTime: string | null;
  typeCode: string | null;
  /** "0100000" standard / "0200000" simplified. */
  subtype: string | null;
  icv: string | null;
  previousInvoiceHash: string | null;
  qr: string | null;
  billingReference: string | null;
  reason: string | null;
  supplyDate: string | null;
  seller: ReadParty;
  buyer: ReadParty | null;
  lines: ReadLine[];
  breakdown: Array<{ category: string | null; percent: string | null; taxable: string | null; tax: string | null }>;
  totals: { lineExtension: string | null; taxExclusive: string | null; taxInclusive: string | null; vat: string | null; payable: string | null };
  /** ZATCA's stamp present (cleared standard documents carry ZATCA's signature). */
  signed: boolean;
};

const kids = (node: XmlElement | undefined, name: string): XmlElement[] =>
  node ? (node.children.filter((c) => typeof c !== "string" && c.name === name) as XmlElement[]) : [];

function path(node: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let cur = node;
  for (const n of names) cur = cur ? findChild(cur, n) : undefined;
  return cur;
}

const text = (node: XmlElement | undefined): string | null => {
  if (!node) return null;
  const t = textOf(node).trim();
  return t || null;
};

const attr = (node: XmlElement | undefined, name: string) => node?.attrs.find(([k]) => k === name)?.[1] ?? null;

function readParty(party: XmlElement | undefined): ReadParty {
  const addr = path(party, "cac:PostalAddress");
  const ident = path(party, "cac:PartyIdentification", "cbc:ID");
  return {
    name: text(path(party, "cac:PartyLegalEntity", "cbc:RegistrationName")),
    vatNumber: text(path(party, "cac:PartyTaxScheme", "cbc:CompanyID")),
    otherId: ident && text(ident) ? { scheme: attr(ident, "schemeID"), value: text(ident)! } : null,
    address: addr
      ? {
          street: text(findChild(addr, "cbc:StreetName")),
          building: text(findChild(addr, "cbc:BuildingNumber")),
          district: text(findChild(addr, "cbc:CitySubdivisionName")),
          city: text(findChild(addr, "cbc:CityName")),
          postalCode: text(findChild(addr, "cbc:PostalZone")),
          country: text(path(addr, "cac:Country", "cbc:IdentificationCode"))
        }
      : null
  };
}

function reference(root: XmlElement, id: string): XmlElement | undefined {
  return kids(root, "cac:AdditionalDocumentReference").find((r) => text(findChild(r, "cbc:ID")) === id);
}

export function readInvoiceXml(xml: string): ReadInvoice | null {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (err) {
    if (err instanceof XmlParseError) return null;
    throw err;
  }
  if (root.name !== "Invoice") return null;
  const typeCode = findChild(root, "cbc:InvoiceTypeCode");
  const taxTotals = kids(root, "cac:TaxTotal");
  const withBreakdown = taxTotals.find((t) => kids(t, "cac:TaxSubtotal").length > 0);
  const lmt = findChild(root, "cac:LegalMonetaryTotal");
  const buyerParty = path(root, "cac:AccountingCustomerParty", "cac:Party");
  return {
    invoiceNumber: text(findChild(root, "cbc:ID")),
    uuid: text(findChild(root, "cbc:UUID")),
    issueDate: text(findChild(root, "cbc:IssueDate")),
    issueTime: text(findChild(root, "cbc:IssueTime")),
    typeCode: text(typeCode),
    subtype: attr(typeCode, "name"),
    icv: text(path(reference(root, "ICV"), "cbc:UUID")),
    previousInvoiceHash: text(path(reference(root, "PIH"), "cac:Attachment", "cbc:EmbeddedDocumentBinaryObject")),
    qr: text(path(reference(root, "QR"), "cac:Attachment", "cbc:EmbeddedDocumentBinaryObject"))?.replace(/\s+/g, "") ?? null,
    billingReference: text(path(root, "cac:BillingReference", "cac:InvoiceDocumentReference", "cbc:ID")),
    reason: text(path(root, "cac:PaymentMeans", "cbc:InstructionNote")),
    supplyDate: text(path(root, "cac:Delivery", "cbc:ActualDeliveryDate")),
    seller: readParty(path(root, "cac:AccountingSupplierParty", "cac:Party")),
    buyer: buyerParty && buyerParty.children.some((c) => typeof c !== "string") ? readParty(buyerParty) : null,
    lines: kids(root, "cac:InvoiceLine").map((line) => {
      const category = path(line, "cac:Item", "cac:ClassifiedTaxCategory");
      return {
        name: text(path(line, "cac:Item", "cbc:Name")) ?? "",
        quantity: text(findChild(line, "cbc:InvoicedQuantity")) ?? "",
        unitPrice: text(path(line, "cac:Price", "cbc:PriceAmount")),
        net: text(findChild(line, "cbc:LineExtensionAmount")) ?? "",
        vat: text(path(line, "cac:TaxTotal", "cbc:TaxAmount")),
        withVat: text(path(line, "cac:TaxTotal", "cbc:RoundingAmount")),
        vatPercent: text(path(category, "cbc:Percent")),
        category: text(path(category, "cbc:ID"))
      };
    }),
    breakdown: withBreakdown
      ? kids(withBreakdown, "cac:TaxSubtotal").map((s) => ({
          category: text(path(s, "cac:TaxCategory", "cbc:ID")),
          percent: text(path(s, "cac:TaxCategory", "cbc:Percent")),
          taxable: text(findChild(s, "cbc:TaxableAmount")),
          tax: text(findChild(s, "cbc:TaxAmount"))
        }))
      : [],
    totals: {
      lineExtension: text(path(lmt, "cbc:LineExtensionAmount")),
      taxExclusive: text(path(lmt, "cbc:TaxExclusiveAmount")),
      taxInclusive: text(path(lmt, "cbc:TaxInclusiveAmount")),
      vat: text(path(taxTotals[0], "cbc:TaxAmount")),
      payable: text(path(lmt, "cbc:PayableAmount"))
    },
    signed: Boolean(findChild(root, "ext:UBLExtensions"))
  };
}
