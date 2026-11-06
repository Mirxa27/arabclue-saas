/**
 * POST /api/merchant/onboarding — the /welcome wizard's only write.
 *
 * Creates (or updates) the signed-in user's merchant profile, records DPA consent and
 * saves the brand kit. Never accepts plan/subscription/billing/Salla/ZATCA fields: a new
 * merchant starts on lite / pending and the chosen plan is paid for at /billing.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { OnboardingBodySchema } from "@/lib/merchant/onboarding-schema";
import { completeOnboarding } from "@/lib/merchant/onboarding";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
    const limited = await enforceRateLimit(req, "merchant:onboarding", 10, 10 * 60_000, { identity: user.id });
    if (limited instanceof NextResponse) return limited;

    const parsed = OnboardingBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }

    const result = await completeOnboarding(getServiceSupabase(), user.id, parsed.data);
    return NextResponse.json({ ok: true, merchantId: result.merchantId, created: result.created });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/merchant/onboarding" });
  }
}
