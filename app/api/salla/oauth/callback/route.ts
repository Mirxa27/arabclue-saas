export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, sallaAPI } from "@/lib/salla/oauth";
import { getServiceSupabase } from "@/lib/db/supabase";
import { verifyOAuthState } from "@/lib/oauth/state";
import { updateAgentStatus } from "@/lib/agents/store-server";

type SallaStoreInfo = { data?: { id?: number; name?: string } };

function failUrl(base: string, cause: string) {
  return new URL(
    `/integrations/callback?platform=salla&status=error&error=${encodeURIComponent(cause)}`,
    base
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code || !stateRaw) {
    return NextResponse.redirect(failUrl(req.url, "missing_code_or_state"));
  }

  try {
    const state = verifyOAuthState(stateRaw);
    const tokens = await exchangeCodeForTokens({
      clientId: process.env.SALLA_CLIENT_ID!,
      clientSecret: process.env.SALLA_CLIENT_SECRET!,
      redirectUri: process.env.SALLA_REDIRECT_URI!,
      code
    });

    let sellerName: string | undefined;
    let sallaMerchantId: string | undefined;
    try {
      const store = await sallaAPI<SallaStoreInfo>("/store/info", tokens.access_token);
      sellerName = store.data?.name;
      sallaMerchantId = store.data?.id != null ? String(store.data.id) : undefined;
    } catch {
      /* store info optional on first install */
    }

    const supabase = getServiceSupabase();
    await supabase.from("merchants").upsert(
      {
        id: state.merchantId,
        salla_state: stateRaw,
        salla_merchant_id: sallaMerchantId,
        seller_name: sellerName,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        installed_at: new Date().toISOString()
      },
      { onConflict: "id" }
    );

    try {
      await updateAgentStatus(state.merchantId, "social", true);
    } catch {
      /* non-critical */
    }

    return NextResponse.redirect(
      new URL("/integrations/callback?platform=salla&status=success", req.url)
    );
  } catch (e) {
    console.error("Salla OAuth callback failed", e);
    const cause = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.redirect(failUrl(req.url, cause));
  }
}
