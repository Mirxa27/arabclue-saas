import type { NextRequest } from "next/server";
import { exchangeTikTokCode, resolveTikTokOpenId } from "@/lib/tiktok/oauth";
import { envConfigured, persistSocialConnection, runOAuthCallback } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/tiktok/callback";

export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "tiktok",
      route: ROUTE,
      statePlatforms: ["tiktok"],
      fallbackPlatform: "tiktok",
      requiresCodeVerifier: true,
      isConfigured: () => envConfigured("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
      exchange: ({ code, codeVerifier }) => exchangeTikTokCode(code, codeVerifier as string),
      persist: ({ tokens, merchantId }) =>
        persistSocialConnection({
          merchantId,
          platform: "tiktok",
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in
          },
          resolveExternalId: async () => tokens.open_id ?? (await resolveTikTokOpenId(tokens.access_token))
        })
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
