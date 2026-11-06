import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantForNavigation } from "@/lib/auth/browser-guard";
import { buildLinkedInAuthorizeURL } from "@/lib/linkedin/oauth";
import { beginOAuthFlow, envValue, oauthStartFailure } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/linkedin/start";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const session = await requireMerchantForNavigation(req);
    if (!session.ok) return session.response;

    const clientId = envValue("LINKEDIN_CLIENT_ID");
    if (!clientId) return oauthStartFailure("linkedin", "not_configured");

    return beginOAuthFlow(req, {
      flow: "linkedin",
      merchantId: session.merchant.id,
      platform: "linkedin",
      authorizeUrl: ({ state }) => buildLinkedInAuthorizeURL({ clientId, state })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
