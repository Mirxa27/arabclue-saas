import { NextRequest, NextResponse } from "next/server";
import { SallaWebhookEventSchema, verifySallaWebhook } from "@/lib/salla/oauth";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { readTextBody } from "@/lib/http/raw-body";
import { handleAppStoreAuthorize, handleAppUninstalled, logSallaEvent } from "@/lib/salla/app-events";
import { runWebhookOnce, sallaWebhookEventId } from "@/lib/webhooks/idempotency";
import { handleSallaOrderCreated } from "@/lib/invoices/salla-orders";

export const runtime = "nodejs";
// order.created issues and reports a ZATCA invoice (lib/invoices/salla-orders.ts)
export const maxDuration = 60;

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
          // ZATCA invoice, or recorded as pending/unmapped — never dropped (lib/invoices/salla-orders.ts)
          await handleSallaOrderCreated(supabase, evt);
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
