import type { NextRequest } from "next/server";
import { exchangeXCode, resolveXUserId } from "@/lib/x/oauth";
import { envConfigured, persistSocialConnection, runOAuthCallback } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/x/callback";

export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "x",
      route: ROUTE,
      statePlatforms: ["x"],
      fallbackPlatform: "x",
      requiresCodeVerifier: true,
      isConfigured: () => envConfigured("X_CLIENT_ID", "X_CLIENT_SECRET"),
      exchange: ({ code, codeVerifier }) => exchangeXCode(code, codeVerifier as string),
      persist: ({ tokens, merchantId }) =>
        persistSocialConnection({
          merchantId,
          platform: "x",
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in
          },
          resolveExternalId: () => resolveXUserId(tokens.access_token)
        })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
