import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/route-handler";
import { createEmployeeBillingIntent } from "@/lib/billing/employee-billing";
import { getPublishableKey } from "@/lib/moyasar/client";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const BodySchema = z.object({
  employeeId: z.string().uuid()
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchant();
    const limited = await enforceRateLimit(req, "billing:employee-intent", 10, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const body = BodySchema.parse(await req.json());
    const { intent, employee } = await createEmployeeBillingIntent(merchant.id, body.employeeId);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;

    return NextResponse.json({
      intentId: intent.given_id,
      employeeId: employee.id,
      amount: intent.amount_halalas,
      currency: intent.currency,
      description: intent.description,
      publishableKey: getPublishableKey(),
      callbackUrl: `${siteUrl}/employees/${employee.id}?billing=complete&intent=${intent.given_id}`,
      metadata: intent.metadata ?? {}
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/billing/intent" });
  }
}
