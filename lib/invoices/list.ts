/**
 * Invoice list filters shared by the invoices page and the CSV export (UI-013), so the export always
 * contains exactly what the merchant is looking at. All queries run on the user's RLS session and
 * are additionally pinned to the merchant id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toAsciiDigits } from "@/lib/i18n/digits";
import type { Invoice, InvoiceStatus } from "@/lib/types/database";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["generated", "submitted", "reported", "cleared", "rejected", "failed"];

export const InvoiceFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(80)
    .transform((v) => toAsciiDigits(v))
    .optional()
    .catch(undefined),
  status: z.enum(INVOICE_STATUSES as [InvoiceStatus, ...InvoiceStatus[]]).optional().catch(undefined)
});

export type InvoiceFilter = z.infer<typeof InvoiceFilterSchema>;

/** searchParams (page) or URLSearchParams (route) → filter; anything invalid is ignored. */
export function parseInvoiceFilter(params: URLSearchParams | Record<string, string | string[] | undefined>): InvoiceFilter {
  const get = (k: string) => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined;
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const q = get("q");
  const status = get("status");
  return InvoiceFilterSchema.parse({ q: q || undefined, status: status || undefined });
}

export function filterQueryString(filter: InvoiceFilter): string {
  const qs = new URLSearchParams();
  if (filter.q) qs.set("q", filter.q);
  if (filter.status) qs.set("status", filter.status);
  return qs.toString();
}

/** Escape a value for a PostgREST ilike pattern inside or(): only plain characters survive. */
function likeTerm(q: string): string | null {
  const term = q.replace(/[^\p{L}\p{N}\s._\-/]/gu, "").trim();
  return term ? term : null;
}

export const INVOICE_LIST_COLUMNS =
  "id, merchant_id, invoice_number, uuid, icv, invoice_type, document_type, environment, status, subtotal, vat, total, buyer_name, buyer_vat_number, salla_order_id, issued_at, created_at, submitted_at, superseded_by, status_note";

export type InvoiceListRow = Pick<
  Invoice,
  | "id"
  | "merchant_id"
  | "invoice_number"
  | "uuid"
  | "icv"
  | "invoice_type"
  | "document_type"
  | "environment"
  | "status"
  | "subtotal"
  | "vat"
  | "total"
  | "buyer_name"
  | "buyer_vat_number"
  | "salla_order_id"
  | "issued_at"
  | "created_at"
  | "submitted_at"
  | "superseded_by"
  | "status_note"
>;

export async function listInvoices(sb: SupabaseClient, merchantId: string, filter: InvoiceFilter, limit: number): Promise<InvoiceListRow[]> {
  let query = sb.from("invoices").select(INVOICE_LIST_COLUMNS).eq("merchant_id", merchantId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.q) {
    const q = filter.q.trim();
    if (/^\d{1,9}$/.test(q)) {
      // a number: the ICV or part of the invoice number / Salla order id
      query = query.or(`icv.eq.${Number(q)},invoice_number.ilike."%${q}%",salla_order_id.eq."${q}"`);
    } else {
      const term = likeTerm(q);
      if (term) query = query.or(`invoice_number.ilike."%${term}%",buyer_name.ilike."%${term}%"`);
    }
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`invoice list failed: ${error.message}`);
  return (data ?? []) as InvoiceListRow[];
}

/** XML Implementation Standard §14: <seller VAT>_<date>T<time>_<invoice number>.xml */
export function zatcaFileName(sellerVat: string | null, issuedAt: string | null, invoiceNumber: string, ext = "xml"): string {
  const ast = new Date(new Date(issuedAt ?? Date.now()).getTime() + 3 * 3600_000).toISOString();
  const date = ast.slice(0, 10).replace(/-/g, "");
  const time = ast.slice(11, 19).replace(/:/g, "");
  const number = invoiceNumber.replace(/[^A-Za-z0-9]/g, "-");
  const vat = sellerVat && /^\d{15}$/.test(sellerVat) ? sellerVat : "invoice";
  return `${vat}_${date}T${time}_${number}.${ext}`;
}
