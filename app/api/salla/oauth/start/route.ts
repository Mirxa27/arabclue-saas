import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantForNavigation } from "@/lib/auth/browser-guard";
import { beginOAuthFlow, oauthStartFailure } from "@/lib/oauth/flow";
import { buildAuthorizeURL } from "@/lib/salla/oauth";
import { sallaOAuthRedirectConfig } from "@/lib/salla/config";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/salla/oauth/start";

/**
 * "Connect Salla" (Custom Mode): a browser navigation, not a fetch. Signed-out visitors go to
 * /login?next=…; the signed state names the session's merchant and its nonce goes into the
 * `ac_oauth_salla` flow cookie the callback checks before it exchanges the code.
 */
export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const session = await requireMerchantForNavigation(req);
    if (!session.ok) return session.response;

    // The callback needs the secret too: don't send the merchant to Salla for a flow that can't finish.
    const config = sallaOAuthRedirectConfig();
    if (!config) return oauthStartFailure("salla", "not_configured");

    return beginOAuthFlow(req, {
      flow: "salla",
      merchantId: session.merchant.id,
      platform: "salla",
      authorizeUrl: ({ state }) =>
        buildAuthorizeURL({ clientId: config.clientId, redirectUri: config.redirectUri, state, scope: "offline_access" })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
