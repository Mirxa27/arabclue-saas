import type { NextRequest } from "next/server";
import { exchangeCodeForTokens, sallaAPI } from "@/lib/salla/oauth";
import { getServiceSupabase } from "@/lib/db/supabase";
import { updateAgentStatus } from "@/lib/agents/store-server";
import { envConfigured, envValue, runOAuthCallback } from "@/lib/oauth/flow";
import { OAuthCallbackError } from "@/lib/oauth/errors";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/salla/oauth/callback";

type SallaStoreInfo = { data?: { id?: number; name?: string } };

/**
 * Salla OAuth callback. Requires a state minted by the Salla start route together with its
 * flow cookie (`setOAuthFlowCookie(res, req, "salla", { nonce })` via beginOAuthFlow) and the
 * signed-in owner of `state.merchantId`; only then is the code exchanged and stored.
 */
export async function GET(req: NextRequest) {
  try {
    return await runOAuthCallback(req, {
      flow: "salla",
      route: ROUTE,
      statePlatforms: ["salla"],
      fallbackPlatform: "salla",
      isConfigured: () => envConfigured("SALLA_CLIENT_ID", "SALLA_CLIENT_SECRET", "SALLA_REDIRECT_URI"),
      exchange: ({ code }) =>
        exchangeCodeForTokens({
          clientId: envValue("SALLA_CLIENT_ID") as string,
          clientSecret: envValue("SALLA_CLIENT_SECRET") as string,
          redirectUri: envValue("SALLA_REDIRECT_URI") as string,
          code
        }),
      persist: async ({ tokens, stateRaw, merchantId }) => {
        let sellerName: string | undefined;
        let sallaMerchantId: string | undefined;
        try {
          const store = await sallaAPI<SallaStoreInfo>("/store/info", tokens.access_token);
          sellerName = store.data?.name;
          sallaMerchantId = store.data?.id != null ? String(store.data.id) : undefined;
        } catch {
          /* store info optional on first install */
        }

        // The session merchant (== state.merchantId, checked by the runner) gets the tokens.
        const { data, error } = await getServiceSupabase()
          .from("merchants")
          .update({
            salla_state: stateRaw,
            salla_merchant_id: sallaMerchantId,
            seller_name: sellerName,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            installed_at: new Date().toISOString()
          })
          .eq("id", merchantId)
          .select("id");
        if (error) {
          // salla_merchant_id is unique: the store already belongs to another merchant row.
          throw new OAuthCallbackError(error.code === "23505" ? "store_already_linked" : "save_failed", error);
        }
        if (!data?.length) throw new OAuthCallbackError("save_failed");

        try {
          await updateAgentStatus(merchantId, "social", true);
        } catch {
          /* non-critical */
        }
      }
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
