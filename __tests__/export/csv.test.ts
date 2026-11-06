/**
 * critic-26 / UI-013 — lib/export/csv.ts: UTF-8 BOM, RFC 4180 quoting, formula-injection guard,
 * Arabic text intact; and the invoice export columns (Arabic + English headers).
 */
import { describe, expect, it } from "vitest";
import { attachmentDisposition, CSV_BOM, escapeCsvCell, toCsv } from "@/lib/export/csv";
import { invoicesToCsv } from "@/lib/invoices/export";
import type { InvoiceListRow } from "@/lib/invoices/list";

describe("escapeCsvCell", () => {
  it("quotes fields with commas, quotes and line breaks (quotes doubled)", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("neutralises cells a spreadsheet would evaluate as formulas", () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil.example","click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""click"")"');
    expect(escapeCsvCell("+966500000000")).toBe("'+966500000000");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\tcmd")).toBe("'\tcmd");
    expect(escapeCsvCell("\rcmd")).toBe("\"'\rcmd\"");
    // numbers stay numbers (a negative amount is not a formula)
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell(115.5)).toBe("115.5");
  });

  it("keeps Arabic text as UTF-8", () => {
    expect(escapeCsvCell("محمد علي")).toBe("محمد علي");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF line ends", () => {
    const csv = toCsv([{ header: "Name / الاسم", value: (r: { n: string }) => r.n }], [{ n: "بيت العود" }, { n: "=1+1" }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(Buffer.from(csv, "utf8").subarray(0, 3).toString("hex")).toBe("efbbbf");
    expect(csv.slice(1)).toBe("Name / الاسم\r\nبيت العود\r\n'=1+1\r\n");
  });

  it("builds an RFC 5987 Content-Disposition with an ASCII fallback", () => {
    expect(attachmentDisposition("فواتير.csv")).toBe(`attachment; filename="______.csv"; filename*=UTF-8''${encodeURIComponent("فواتير.csv")}`);
  });
});

describe("invoice CSV", () => {
  const row: InvoiceListRow = {
    id: "i1",
    merchant_id: "m1",
    invoice_number: "INV-41027662",
    uuid: "8e6000cf-1a98-4174-b3e7-b5d5954bc10d",
    icv: 7,
    invoice_type: "simplified",
    document_type: "invoice",
    environment: "production",
    status: "reported",
    subtotal: 196,
    vat: 29.4,
    total: 225.4,
    buyer_name: '=HYPERLINK("http://evil.example","محمد")',
    buyer_vat_number: null,
    salla_order_id: "2116149737",
    issued_at: "2026-11-06T09:21:45.000Z",
    created_at: "2026-11-06T09:21:46.000Z",
    submitted_at: null,
    superseded_by: null,
    status_note: null
  };

  it("has Arabic + English headers, AST dates, numeric amounts and guarded buyer names", () => {
    const csv = invoicesToCsv([row]);
    const [header, line] = csv.slice(1).split("\r\n");
    expect(header).toContain("Invoice number / رقم الفاتورة");
    expect(header).toContain("Buyer / المشتري");
    expect(header).toContain("Total SAR / الإجمالي");
    expect(line).toContain("2026-11-06 12:21:45"); // 09:21:45Z in Riyadh
    expect(line).toContain(",196,29.4,225.4,");
    expect(line).toContain('"\'=HYPERLINK(""http://evil.example"",""محمد"")"');
    expect(line).toContain("Reported to ZATCA");
    expect(line).toContain("Simplified tax invoice / فاتورة ضريبية مبسطة");
  });
});
