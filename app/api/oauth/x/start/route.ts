import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantForNavigation } from "@/lib/auth/browser-guard";
import { buildXAuthorizeURL } from "@/lib/x/oauth";
import { beginOAuthFlow, envValue, oauthStartFailure } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { socialConnectBlock } from "@/lib/social/gates";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/x/start";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const session = await requireMerchantForNavigation(req);
    if (!session.ok) return session.response;

    // SW-13: the plan and the admin's "Social OAuth" kill switch gate every social connect.
    const blocked = await socialConnectBlock(session.merchant);
    if (blocked) return oauthStartFailure("x", blocked);

    const clientId = envValue("X_CLIENT_ID");
    if (!clientId) return oauthStartFailure("x", "not_configured");

    // PKCE: the verifier stays in the httpOnly flow cookie, only the challenge leaves.
    return beginOAuthFlow(req, {
      flow: "x",
      merchantId: session.merchant.id,
      platform: "x",
      pkce: true,
      authorizeUrl: ({ state, codeChallenge }) =>
        buildXAuthorizeURL({ clientId, state, codeChallenge: codeChallenge as string })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
