import type { NextRequest } from "next/server";
import { exchangeCodeForTokens, fetchSallaStoreInfo, fetchSallaUserInfo, type SallaStoreIdentity } from "@/lib/salla/oauth";
import { sallaOAuthRedirectConfig } from "@/lib/salla/config";
import { encryptSallaTokens, linkSallaStore } from "@/lib/salla/connect";
import { getServiceSupabase } from "@/lib/db/supabase";
import { enableSocialAgentOnFirstConnect } from "@/lib/social/gates";
import { runOAuthCallback } from "@/lib/oauth/flow";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/salla/oauth/callback";

/** Which store the token belongs to: user/info (needs only offline_access), else /store/info. */
async function resolveStore(accessToken: string): Promise<SallaStoreIdentity> {
  try {
    return await fetchSallaUserInfo(accessToken);
  } catch {
    try {
      return await fetchSallaStoreInfo(accessToken);
    } catch (err) {
      // Without the store id, order webhooks could never reach this merchant: don't claim success.
      throw new OAuthCallbackError("account_lookup_failed", err);
    }
  }
}

/**
 * Salla OAuth callback (Custom Mode). Requires a state minted by /api/salla/oauth/start for the
 * platform "salla", its `ac_oauth_salla` flow cookie, and the signed-in owner of state.merchantId
 * (lib/oauth/flow.ts checks all of it before the code is exchanged). The tokens are stored
 * encrypted on the service role; a store owned by another merchant → `store_already_linked`.
 */
export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "salla",
      route: ROUTE,
      statePlatforms: ["salla"],
      fallbackPlatform: "salla",
      isConfigured: () => sallaOAuthRedirectConfig() !== null,
      exchange: ({ code }) => {
        const config = sallaOAuthRedirectConfig();
        if (!config) throw new OAuthCallbackError("not_configured");
        return exchangeCodeForTokens({ ...config, code });
      },
      persist: async ({ tokens, merchantId }) => {
        const store = await resolveStore(tokens.access_token);
        const outcome = await linkSallaStore(getServiceSupabase(), {
          merchantId,
          storeId: store.storeId,
          storeName: store.storeName,
          tokens: encryptSallaTokens(tokens)
        });
        if (outcome === "store_already_linked") throw new OAuthCallbackError("store_already_linked");
        if (outcome !== "linked") throw new OAuthCallbackError("save_failed");

        try {
          // Only switches the agent on when the merchant's plan includes the social module (RA-12),
          // and only on the first connect: a reconnect never re-enables a paused agent (SW-11).
          await enableSocialAgentOnFirstConnect(merchantId);
        } catch {
          /* non-critical: the store is connected either way */
        }
      }
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
