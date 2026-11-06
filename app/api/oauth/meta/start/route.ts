import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantForNavigation } from "@/lib/auth/browser-guard";
import { buildMetaAuthorizeURL, type MetaOAuthTarget } from "@/lib/meta/oauth";
import { beginOAuthFlow, envValue, oauthStartFailure } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/meta/start";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const session = await requireMerchantForNavigation(req);
    if (!session.ok) return session.response;

    const target = req.nextUrl.searchParams.get("target") ?? "instagram";
    if (target !== "instagram" && target !== "whatsapp") {
      return oauthStartFailure("meta", "invalid_request");
    }

    const appId = envValue("META_APP_ID");
    if (!appId) return oauthStartFailure(target, "not_configured");

    return beginOAuthFlow(req, {
      flow: "meta",
      merchantId: session.merchant.id,
      platform: target,
      authorizeUrl: ({ state }) => buildMetaAuthorizeURL({ appId, state, target: target as MetaOAuthTarget })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
