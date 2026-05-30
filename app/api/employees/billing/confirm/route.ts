import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/route-handler";
import { confirmEmployeeBillingPayment } from "@/lib/billing/employee-billing";

const BodySchema = z.object({
  paymentId: z.string().uuid(),
  intentId: z.string().uuid()
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchant();
    const body = BodySchema.parse(await req.json());
    const result = await confirmEmployeeBillingPayment({
      merchantId: merchant.id,
      moyasarPaymentId: body.paymentId,
      intentId: body.intentId
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/billing/confirm" });
  }
}
