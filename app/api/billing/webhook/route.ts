import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { MoyasarWebhookEventSchema } from "@/lib/moyasar/types";
import { verifyMoyasarWebhook } from "@/lib/moyasar/webhook";
import { handleMoyasarWebhookPayment } from "@/lib/billing/service";
import { getServiceSupabase } from "@/lib/db/supabase";
import { runWebhookOnce } from "@/lib/webhooks/idempotency";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-moyasar-signature");
    const secret = process.env.MOYASAR_WEBHOOK_SECRET;

    if (secret && !verifyMoyasarWebhook(raw, signature, secret)) {
      return new NextResponse("invalid signature", { status: 401 });
    }

    const event = MoyasarWebhookEventSchema.parse(JSON.parse(raw));
    const supabase = getServiceSupabase();
    // Claim → process → complete; a failure releases the claim so Moyasar's retry is processed.
    const outcome = await runWebhookOnce(supabase, "moyasar", event.id, async () => {
      if (event.type === "payment_paid" || event.type === "payment_captured") {
        await handleMoyasarWebhookPayment(event.data.id);
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
    return handleRouteError(err);
  }
}
