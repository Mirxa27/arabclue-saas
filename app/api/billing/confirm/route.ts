import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/route-handler";
import { confirmBillingPayment } from "@/lib/billing/service";

const BodySchema = z.object({
  paymentId: z.string().uuid(),
  intentId: z.string().uuid()
});

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const body = BodySchema.parse(await req.json());
    const result = await confirmBillingPayment({
      merchantId: merchant.id,
      moyasarPaymentId: body.paymentId,
      intentId: body.intentId
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleRouteError(err);
  }
}
