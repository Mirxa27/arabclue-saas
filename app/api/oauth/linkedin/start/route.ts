export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { createOAuthState } from "@/lib/oauth/state";
import { buildLinkedInAuthorizeURL } from "@/lib/linkedin/oauth";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.redirect(new URL("/welcome", req.url));

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) return NextResponse.json({ error: "LINKEDIN_CLIENT_ID not configured" }, { status: 503 });

    const state = createOAuthState({ merchantId: merchant.id, platform: "linkedin" });
    return NextResponse.redirect(buildLinkedInAuthorizeURL({ clientId, state }));
  } catch (err) {
    return handleRouteError(err);
  }
}
