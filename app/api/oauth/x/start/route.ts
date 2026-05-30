export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { createOAuthState } from "@/lib/oauth/state";
import { generatePkcePair } from "@/lib/oauth/pkce";
import { buildXAuthorizeURL } from "@/lib/x/oauth";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const PKCE_COOKIE = "oauth_pkce_x";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.redirect(new URL("/welcome", req.url));

    const clientId = process.env.X_CLIENT_ID;
    if (!clientId) return NextResponse.json({ error: "X_CLIENT_ID not configured" }, { status: 503 });

    const { verifier, challenge } = generatePkcePair();
    const state = createOAuthState({
      merchantId: merchant.id,
      platform: "x",
      codeChallenge: challenge
    });

    const res = NextResponse.redirect(buildXAuthorizeURL({ clientId, state, codeChallenge: challenge }));
    res.cookies.set(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/"
    });
    return res;
  } catch (err) {
    return handleRouteError(err);
  }
}
