/**
 * GET /api/invoices/[id]/print — the invoice as a print-optimised bilingual page (UI-012). The PDF
 * comes from the browser's "Print → Save as PDF", as the page says; the legal document is the XML.
 * Merchant-scoped, never gated.
 */
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { notFound } from "@/lib/api/errors";
import { PRINT_CSP, renderInvoicePrintHtml } from "@/lib/invoices/print";
import { readInvoiceXml } from "@/lib/zatca/read";
import { zatcaRouteError } from "@/lib/zatca/route-errors";
import type { InvoiceStatus } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const merchant = await requireMerchantApi();
    const { id } = await props.params;
    if (!z.string().uuid().safeParse(id).success) throw notFound("Invoice");
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("invoices")
      .select("id, status, environment, xml, cleared_xml, qr_base64")
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    if (error) throw new Error(`invoice lookup failed: ${error.message}`);
    if (!data) throw notFound("Invoice");
    const inv = data as { status: InvoiceStatus; environment: string | null; xml: string; cleared_xml: string | null; qr_base64: string | null };
    const doc = readInvoiceXml(inv.cleared_xml ?? inv.xml);
    if (!doc) throw new Error("stored invoice XML could not be read");
    const qr = doc.qr ?? inv.qr_base64;
    const qrDataUrl = qr ? await QRCode.toDataURL(qr, { errorCorrectionLevel: "M", margin: 1, width: 320 }) : null;
    const html = renderInvoicePrintHtml({ doc, status: inv.status, environment: inv.environment, qrDataUrl });
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": PRINT_CSP,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      }
    });
  } catch (err) {
    return zatcaRouteError(err, "GET /api/invoices/[id]/print");
  }
}
