import { describe, it, expect } from "vitest";
import { generateInvoice, computeTotals, buildQRBase64 } from "@/lib/zatca/invoice";

describe("computeTotals", () => {
  it("computes line subtotals and VAT correctly at 15%", () => {
    const totals = computeTotals([
      { name: "Oud bottle 30ml", quantity: 2, unitPrice: 350, vatRate: 0.15 },
      { name: "Bakhoor box", quantity: 1, unitPrice: 120, vatRate: 0.15 }
    ]);
    expect(totals.subtotal).toBe(820);
    expect(totals.vat).toBe(123);
    expect(totals.total).toBe(943);
  });

  it("handles zero-rated lines", () => {
    const totals = computeTotals([{ name: "Export", quantity: 1, unitPrice: 100, vatRate: 0 }]);
    expect(totals.vat).toBe(0);
    expect(totals.total).toBe(100);
  });
});

describe("buildQRBase64", () => {
  it("produces deterministic base64 for a fixed input", () => {
    const qr = buildQRBase64({
      sellerName: "بيت العود",
      vatNumber: "300000000000003",
      issuedAtISO: "2026-06-01T10:00:00.000Z",
      total: 100.0,
      vat: 15.0
    });
    expect(typeof qr).toBe("string");
    expect(qr.length).toBeGreaterThan(20);
    // Round-trip the first TLV (tag 1, seller name) to verify structure
    const buf = Buffer.from(qr, "base64");
    expect(buf[0]).toBe(1); // tag
    const len = buf[1];
    expect(buf.slice(2, 2 + len).toString("utf8")).toBe("بيت العود");
  });
});

describe("generateInvoice", () => {
  const validInvoice = {
    invoiceNumber: "INV-1001",
    issueDate: new Date("2026-06-01T10:00:00.000Z"),
    icv: 1,
    seller: {
      name: "Bayt Al-Oud",
      vatNumber: "300000000000003",
      crNumber: "1010101010",
      address: { street: "King Fahd Rd", building: "1234", city: "Riyadh", postalCode: "12345" }
    },
    lines: [{ name: "Oud bottle", quantity: 1, unitPrice: 200, vatRate: 0.15 }]
  };

  it("generates a UUID, QR, XML, and hash", () => {
    const inv = generateInvoice(validInvoice);
    expect(inv.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(inv.qrBase64.length).toBeGreaterThan(20);
    expect(inv.xml).toContain("<Invoice");
    expect(inv.xml).toContain("300000000000003");
    expect(inv.invoiceHash).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("rejects invalid VAT numbers", () => {
    expect(() => generateInvoice({ ...validInvoice, seller: { ...validInvoice.seller, vatNumber: "12345" } })).toThrow();
  });

  it("chains hashes correctly when previousInvoiceHash provided", () => {
    const a = generateInvoice(validInvoice);
    const b = generateInvoice({ ...validInvoice, invoiceNumber: "INV-1002", icv: 2, previousInvoiceHash: a.invoiceHash });
    expect(b.xml).toContain(a.invoiceHash);
  });
});
