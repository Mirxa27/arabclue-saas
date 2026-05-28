import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { MoyasarWebhookEventSchema } from "@/lib/moyasar/types";
import { verifyMoyasarWebhook } from "@/lib/moyasar/webhook";
import { handleMoyasarWebhookPayment } from "@/lib/billing/service";

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

    if (event.type === "payment_paid" || event.type === "payment_captured") {
      await handleMoyasarWebhookPayment(event.data.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
