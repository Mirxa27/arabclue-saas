/**
 * CSV for spreadsheet users (critic-26):
 *  - UTF-8 with a byte-order mark, so Excel does not open Arabic text in a legacy code page;
 *  - RFC 4180: CRLF line ends; a field containing a comma, quote, CR or LF is quoted and its
 *    quotes doubled;
 *  - formula-injection guard (OWASP CSV injection): a text cell starting with = + - @ TAB or CR
 *    is prefixed with an apostrophe so spreadsheets show it as text instead of evaluating it.
 *    Numbers (typeof number) are written as-is — a negative amount stays a number.
 */

export const CSV_BOM = "\uFEFF";
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

export type CsvCell = string | number | boolean | null | undefined | Date;

export type CsvColumn<T> = { header: string; value: (row: T) => CsvCell };

const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  let text: string;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    text = String(cell);
  } else if (typeof cell === "boolean") {
    text = cell ? "true" : "false";
  } else if (cell instanceof Date) {
    text = Number.isNaN(cell.getTime()) ? "" : cell.toISOString();
  } else {
    text = cell;
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: ReadonlyArray<CsvColumn<T>>, rows: ReadonlyArray<T>, opts: { bom?: boolean } = {}): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return `${opts.bom === false ? "" : CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** A Content-Disposition value with an ASCII fallback and the RFC 5987 UTF-8 form. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
