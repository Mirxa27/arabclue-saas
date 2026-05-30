import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/route-handler";
import { createBillingIntent } from "@/lib/billing/service";
import { getPlan, type BillingPlan } from "@/lib/billing/plans";
import { getPublishableKey } from "@/lib/moyasar/client";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const BodySchema = z.object({
  plan: z.enum(["lite", "plus", "pro"])
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const limited = await enforceRateLimit(req, "billing:intent", 10, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const body = BodySchema.parse(await req.json());
    const plan = body.plan as BillingPlan;
    const intent = await createBillingIntent(merchant.id, plan);
    const planDef = getPlan(plan);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;

    return NextResponse.json({
      intentId: intent.given_id,
      plan,
      amount: planDef.amountHalalas,
      currency: planDef.currency,
      description: planDef.description,
      publishableKey: getPublishableKey(),
      callbackUrl: `${siteUrl}/billing/complete?intent=${intent.given_id}`,
      metadata: {
        merchant_id: merchant.id,
        plan,
        intent_id: intent.given_id
      }
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
