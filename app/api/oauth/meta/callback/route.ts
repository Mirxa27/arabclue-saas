import type { NextRequest } from "next/server";
import { exchangeMetaCode, resolveInstagramAccount, resolveWhatsAppPhoneId } from "@/lib/meta/oauth";
import { envConfigured, persistSocialConnection, runOAuthCallback } from "@/lib/oauth/flow";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/oauth/meta/callback";

export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "meta",
      route: ROUTE,
      statePlatforms: ["instagram", "whatsapp"],
      fallbackPlatform: "meta",
      isConfigured: () => envConfigured("META_APP_ID", "META_APP_SECRET"),
      exchange: ({ code }) => exchangeMetaCode(code),
      persist: ({ tokens, state, merchantId }) => {
        const platform = state.platform === "whatsapp" ? "whatsapp" : "instagram";
        return persistSocialConnection({
          merchantId,
          platform,
          tokens: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn },
          resolveExternalId: async () =>
            platform === "instagram"
              ? (await resolveInstagramAccount(tokens.accessToken)).igUserId
              : resolveWhatsAppPhoneId(tokens.accessToken)
        });
      }
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
