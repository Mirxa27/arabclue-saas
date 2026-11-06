import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, getSessionContext } from "@/lib/auth/session";
import { HttpError } from "@/lib/api/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { claimSallaInstall } from "@/lib/salla/connect";

export const dynamic = "force-dynamic";

const ROUTE = "POST /api/salla/installs/claim";

const BodySchema = z.object({
  /** Which of the caller's claimable installs to link (GET /api/integrations/status → salla_pending_install). */
  store_id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
});

/**
 * Link a Salla App Store (Easy Mode) install to the signed-in merchant. The install must have been
 * authorized by the Salla store owner with the same email as this session's confirmed email
 * (checked in salla_claim_install); the store id in the body only selects among those.
 */
export async function POST(req: NextRequest) {
  try {
    const { user, merchant } = await getSessionContext();
    if (!user) throw new AuthError();
    if (!merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
    if (!user.email || !user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Confirm your email address before linking a Salla store", code: "email_not_confirmed" },
        { status: 403 }
      );
    }

    const limited = await enforceRateLimit(req, "salla:claim", 10, 10 * 60_000, user.id);
    if (limited instanceof NextResponse) return limited;

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error), code: "invalid_request" }, { status: 400 });
    }

    const outcome = await claimSallaInstall(getServiceSupabase(), {
      merchantId: merchant.id,
      storeId: parsed.data.store_id,
      ownerEmail: user.email
    });
    switch (outcome) {
      case "linked":
        return NextResponse.json({ ok: true, store_id: parsed.data.store_id });
      case "store_already_linked":
        return NextResponse.json(
          { error: "This Salla store is already linked to another account", code: "store_already_linked" },
          { status: 409 }
        );
      case "not_found":
      case "merchant_not_found":
        return NextResponse.json(
          { error: "No Salla install for your email was found", code: "install_not_found" },
          { status: 404 }
        );
    }
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
