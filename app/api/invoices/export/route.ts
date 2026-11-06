/**
 * GET /api/invoices/export?q=&status= — the invoices the list shows, as CSV (UI-013, critic-26):
 * UTF-8 BOM, RFC 4180 quoting, formula-injection guard, Arabic + English headers. Merchant-scoped,
 * never gated (the merchant's own records).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { attachmentDisposition, CSV_CONTENT_TYPE } from "@/lib/export/csv";
import { invoicesToCsv } from "@/lib/invoices/export";
import { listInvoices, parseInvoiceFilter } from "@/lib/invoices/list";
import { zatcaRouteError } from "@/lib/zatca/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

export async function GET(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "invoices:export", 20, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const filter = parseInvoiceFilter(req.nextUrl.searchParams);
    const rows = await listInvoices(await getServerSupabase(), merchant.id, filter, MAX_ROWS);
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    return new NextResponse(invoicesToCsv(rows), {
      headers: {
        "content-type": CSV_CONTENT_TYPE,
        "content-disposition": attachmentDisposition(`arabclue-invoices-${day}.csv`),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(rows.length === MAX_ROWS ? { "x-export-truncated": String(MAX_ROWS) } : {})
      }
    });
  } catch (err) {
    return zatcaRouteError(err, "GET /api/invoices/export");
  }
}
