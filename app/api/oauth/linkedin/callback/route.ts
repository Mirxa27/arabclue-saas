import type { NextRequest } from "next/server";
import { exchangeLinkedInCode, resolveLinkedInActorUrn } from "@/lib/linkedin/oauth";
import { envConfigured, persistSocialConnection, runOAuthCallback } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/linkedin/callback";

export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "linkedin",
      route: ROUTE,
      statePlatforms: ["linkedin"],
      fallbackPlatform: "linkedin",
      isConfigured: () => envConfigured("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"),
      exchange: ({ code }) => exchangeLinkedInCode(code),
      persist: ({ tokens, merchantId }) =>
        persistSocialConnection({
          merchantId,
          platform: "linkedin",
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in
          },
          resolveExternalId: () => resolveLinkedInActorUrn(tokens.access_token)
        })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
