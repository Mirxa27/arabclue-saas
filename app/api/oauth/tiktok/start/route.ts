export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { createOAuthState } from "@/lib/oauth/state";
import { generatePkcePair } from "@/lib/oauth/pkce";
import { buildTikTokAuthorizeURL } from "@/lib/tiktok/oauth";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const PKCE_COOKIE = "oauth_pkce_tiktok";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.redirect(new URL("/welcome", req.url));

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    if (!clientKey) return NextResponse.json({ error: "TIKTOK_CLIENT_KEY not configured" }, { status: 503 });

    const { verifier, challenge } = generatePkcePair();
    const state = createOAuthState({
      merchantId: merchant.id,
      platform: "tiktok",
      codeChallenge: challenge
    });

    const res = NextResponse.redirect(
      buildTikTokAuthorizeURL({ clientKey, state, codeChallenge: challenge })
    );
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
