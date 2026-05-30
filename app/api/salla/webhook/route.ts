import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SallaWebhookEventSchema, verifySallaWebhook } from "@/lib/salla/oauth";
import { generateInvoice } from "@/lib/zatca/invoice";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { SallaOrderCreatedEventSchema } from "@/lib/types/salla";
import { claimWebhookEvent, sallaWebhookEventId } from "@/lib/webhooks/idempotency";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Merchant, SellerAddress } from "@/lib/types/database";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-salla-signature") ?? "";

    if (!verifySallaWebhook(raw, signature, process.env.SALLA_WEBHOOK_SECRET!)) {
      return new NextResponse("invalid signature", { status: 401 });
    }

    const evt = SallaWebhookEventSchema.parse(JSON.parse(raw));
    const supabase = getServiceSupabase();
    const eventId = sallaWebhookEventId(raw, evt);
    const claim = await claimWebhookEvent(supabase, "salla", eventId);
    if (claim === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    switch (evt.event) {
      case "order.created":
        await handleOrderCreated(SallaOrderCreatedEventSchema.parse(evt), supabase);
        break;
      case "app.installed":
        await supabase.from("events").insert({ kind: "salla.installed", merchant: String(evt.merchant), payload: evt });
        break;
      case "app.uninstalled":
        await supabase.from("merchants").update({ uninstalled_at: new Date().toISOString() }).eq("salla_merchant_id", String(evt.merchant));
        break;
      default:
        await supabase.from("events").insert({ kind: evt.event, merchant: String(evt.merchant), payload: evt });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

async function handleOrderCreated(
  evt: z.infer<typeof SallaOrderCreatedEventSchema>,
  supabase: SupabaseClient
) {
  const { data: merchantRow, error: merchantErr } = await supabase
    .from("merchants")
    .select("*")
    .eq("salla_merchant_id", String(evt.merchant))
    .single();

  if (merchantErr || !merchantRow) return;

  const merchant = merchantRow as Merchant;
  const order = evt.data;

  const { data: last } = await supabase
    .from("invoices")
    .select("invoice_hash, icv")
    .eq("merchant_id", merchant.id)
    .order("icv", { ascending: false })
    .limit(1)
    .maybeSingle();

  const icv = (last?.icv ?? 0) + 1;

  const sellerAddress = (merchant.seller_address ?? {}) as Partial<SellerAddress>;
  const address = {
    street: sellerAddress.street ?? "—",
    building: sellerAddress.building ?? "—",
    city: sellerAddress.city ?? "Riyadh",
    postalCode: sellerAddress.postalCode ?? "00000",
    district: sellerAddress.district
  };

  const invoice = generateInvoice({
    invoiceNumber: `INV-${order.id}`,
    issueDate: new Date(order.created_at ?? Date.now()),
    icv,
    previousInvoiceHash: last?.invoice_hash,
    seller: {
      name: merchant.seller_name ?? "Merchant",
      vatNumber: merchant.vat_number ?? "",
      crNumber: merchant.cr_number ?? undefined,
      address
    },
    buyer: order.customer?.vat_number
      ? { name: order.customer?.name ?? "—", vatNumber: order.customer.vat_number }
      : undefined,
    lines: (order.items ?? []).map((it) => ({
      name: it.name,
      quantity: it.quantity ?? 1,
      unitPrice: Number(it.price ?? 0),
      vatRate: 0.15
    }))
  });

  await supabase.from("invoices").insert({
    merchant_id: merchant.id,
    salla_order_id: String(order.id),
    invoice_number: invoice.invoiceNumber,
    uuid: invoice.uuid,
    icv,
    invoice_hash: invoice.invoiceHash,
    qr_base64: invoice.qrBase64,
    xml: invoice.xml,
    subtotal: invoice.totals.subtotal,
    vat: invoice.totals.vat,
    total: invoice.totals.total,
    status: "generated",
    created_at: new Date().toISOString()
  });

  const csid = merchant.zatca_csid ?? process.env.ZATCA_CSID;
  if (csid) {
    const { submitToFatoora } = await import("@/lib/zatca/fatoora");
    const result = await submitToFatoora({
      xml: invoice.xml,
      uuid: invoice.uuid,
      invoiceHash: invoice.invoiceHash,
      csid,
      base: process.env.ZATCA_FATOORA_BASE
    });
    await supabase
      .from("invoices")
      .update({
        status: result.cleared ? "cleared" : "rejected",
        fatoora_response: result.raw
      })
      .eq("merchant_id", merchant.id)
      .eq("uuid", invoice.uuid);
  }
}
