/**
 * GET /api/zatca/invoice/[id]/download?format=xml|signed-xml|qr (UI-012) — merchant-scoped, never
 * gated (legal records).
 *   xml         the legal document: ZATCA's cleared XML for a cleared standard invoice, otherwise
 *               the signed XML; file named per the XML Implementation Standard §14
 *   signed-xml  the document exactly as arabclue signed and submitted it
 *   qr          the QR code as a PNG (ZATCA's QR for cleared standard invoices)
 */
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { HttpError, notFound } from "@/lib/api/errors";
import { attachmentDisposition } from "@/lib/export/csv";
import { zatcaFileName } from "@/lib/invoices/list";
import { zatcaRouteError } from "@/lib/zatca/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({ format: z.enum(["xml", "signed-xml", "qr"]).default("xml") });

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const merchant = await requireMerchantApi();
    const { id } = await props.params;
    if (!z.string().uuid().safeParse(id).success) throw notFound("Invoice");
    const parsed = QuerySchema.safeParse({ format: req.nextUrl.searchParams.get("format") ?? undefined });
    if (!parsed.success) throw new HttpError(400, "format must be xml, signed-xml or qr", "invalid_format");

    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_number, xml, cleared_xml, qr_base64, issued_at, created_at")
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    if (error) throw new Error(`invoice lookup failed: ${error.message}`);
    if (!data) throw notFound("Invoice");
    const inv = data as { invoice_number: string; xml: string; cleared_xml: string | null; qr_base64: string; issued_at: string | null; created_at: string };

    const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
    if (parsed.data.format === "qr") {
      if (!inv.qr_base64) throw notFound("QR code");
      const png = await QRCode.toBuffer(inv.qr_base64, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 512 });
      return new NextResponse(new Uint8Array(png), {
        headers: { ...headers, "content-type": "image/png", "content-disposition": attachmentDisposition(`${inv.invoice_number}-qr.png`) }
      });
    }
    const body = parsed.data.format === "xml" ? (inv.cleared_xml ?? inv.xml) : inv.xml;
    const name = zatcaFileName(merchant.vat_number, inv.issued_at ?? inv.created_at, inv.invoice_number);
    return new NextResponse(body, {
      headers: {
        ...headers,
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": attachmentDisposition(parsed.data.format === "xml" ? name : name.replace(/\.xml$/, "-signed.xml"))
      }
    });
  } catch (err) {
    return zatcaRouteError(err, "GET /api/zatca/invoice/[id]/download");
  }
}
