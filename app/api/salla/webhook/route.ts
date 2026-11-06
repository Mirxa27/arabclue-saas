import { NextRequest, NextResponse } from "next/server";
import { SallaWebhookEventSchema, verifySallaWebhook, type SallaWebhookEvent } from "@/lib/salla/oauth";
import { generateInvoice } from "@/lib/zatca/invoice";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { readTextBody } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { SallaOrderCreatedEventSchema } from "@/lib/types/salla";
import { mapSallaOrderToInvoice } from "@/lib/salla/order-invoice";
import { handleAppStoreAuthorize, handleAppUninstalled, logSallaEvent } from "@/lib/salla/app-events";
import { runWebhookOnce, sallaWebhookEventId } from "@/lib/webhooks/idempotency";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Merchant, SellerAddress } from "@/lib/types/database";

export const runtime = "nodejs";

const ROUTE = "POST /api/salla/webhook";

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.SALLA_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return NextResponse.json({ error: "Salla webhooks are not configured", code: "not_configured" }, { status: 503 });
    }

    const raw = await readTextBody(req);
    const signature = req.headers.get("x-salla-signature") ?? "";

    if (!verifySallaWebhook(raw, signature, secret)) {
      return new NextResponse("invalid signature", { status: 401 });
    }

    const evt = SallaWebhookEventSchema.parse(JSON.parse(raw));
    const supabase = getServiceSupabase();
    const eventId = sallaWebhookEventId(raw, evt);
    // Claim → process → complete; a failure releases the claim so Salla's retry is processed.
    const outcome = await runWebhookOnce(supabase, "salla", eventId, async () => {
      switch (evt.event) {
        case "order.created":
          await handleOrderCreated(evt, supabase);
          break;
        case "app.store.authorize":
          // Easy Mode token delivery: encrypted onto the store's merchant, or parked for a claim.
          await handleAppStoreAuthorize(supabase, evt);
          break;
        case "app.installed":
          await logSallaEvent(supabase, "salla.installed", String(evt.merchant), evt);
          break;
        case "app.uninstalled":
          await handleAppUninstalled(supabase, evt);
          break;
        default:
          // Credential fields are stripped before anything reaches the events log.
          await logSallaEvent(supabase, evt.event, String(evt.merchant), evt);
      }
    });
    if (outcome.status === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (outcome.status === "in_progress") {
      return NextResponse.json({ error: "event is being processed" }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}

/** An order.created we will not invoice automatically: recorded for the merchant/ops, not retried. */
async function recordUnmappedOrder(
  supabase: SupabaseClient,
  merchantId: string,
  evt: SallaWebhookEvent,
  reason: string,
  detail: Record<string, unknown>
) {
  const orderId =
    evt.data && typeof evt.data === "object" && "id" in evt.data ? String((evt.data as { id?: unknown }).id ?? "") : null;
  reportError(new Error(`Salla order.created not invoiced: ${reason}`), {
    route: ROUTE,
    merchantId,
    extra: { reason, order_id: orderId, ...detail }
  });
  await logSallaEvent(supabase, "salla.order.unmapped", merchantId, { reason, order_id: orderId, ...detail });
}

async function handleOrderCreated(evt: SallaWebhookEvent, supabase: SupabaseClient) {
  const { data: merchantRow, error: merchantErr } = await supabase
    .from("merchants")
    .select("*")
    .eq("salla_merchant_id", String(evt.merchant))
    .single();

  if (merchantErr || !merchantRow) return;

  const merchant = merchantRow as Merchant;

  // Parse the documented order model (docs.salla.dev/doc-433804) and map it onto the invoice
  // input. A payload that does not reconcile with its own totals is recorded instead of invoiced:
  // redelivering it would not change it.
  const parsed = SallaOrderCreatedEventSchema.safeParse(evt);
  if (!parsed.success) {
    await recordUnmappedOrder(supabase, merchant.id, evt, "invalid_payload", {
      issues: parsed.error.issues.slice(0, 8).map((issue) => issue.path.join("."))
    });
    return;
  }
  const order = parsed.data.data;
  const mapped = mapSallaOrderToInvoice(order);
  if (!mapped.ok) {
    await recordUnmappedOrder(supabase, merchant.id, evt, mapped.reason, mapped.detail);
    return;
  }
  // `unit_price_below_halala` is expected until the generator has allowance elements; report the rest.
  const notable = mapped.invoice.warnings.filter((w) => w !== "unit_price_below_halala");
  if (notable.length) {
    reportError(new Error("Salla order mapped with warnings"), {
      route: ROUTE,
      merchantId: merchant.id,
      extra: { order_id: String(order.id), warnings: notable, rounding: mapped.invoice.roundingDifference }
    });
  }

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
    issueDate: mapped.invoice.issueDate,
    icv,
    previousInvoiceHash: last?.invoice_hash,
    seller: {
      name: merchant.seller_name ?? "Merchant",
      vatNumber: merchant.vat_number ?? "",
      crNumber: merchant.cr_number ?? undefined,
      address
    },
    buyer: mapped.invoice.buyer,
    lines: mapped.invoice.lines
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
