export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { verifyOAuthState } from "@/lib/oauth/state";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import {
  exchangeMetaCode,
  resolveInstagramAccount,
  resolveWhatsAppPhoneId
} from "@/lib/meta/oauth";
import { updateAgentStatus } from "@/lib/agents/store-server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code || !stateRaw) {
    return NextResponse.redirect(new URL("/integrations/callback?platform=meta&status=error&error=missing_params", req.url));
  }

  let platform: string | undefined;
  try {
    const state = verifyOAuthState(stateRaw);
    if (state.platform !== "instagram" && state.platform !== "whatsapp") {
      throw new Error("Invalid platform in OAuth state");
    }
    platform = state.platform;

    const { accessToken, expiresIn } = await exchangeMetaCode(code);
    const supabase = getServiceSupabase();

    if (platform === "instagram") {
      const { igUserId } = await resolveInstagramAccount(accessToken);
      await upsertSocialChannel(supabase, state.merchantId, "instagram", {
        externalId: igUserId,
        accessToken,
        tokenExpiresAt: expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : undefined
      });
    } else {
      const phoneId = await resolveWhatsAppPhoneId(accessToken);
      await upsertSocialChannel(supabase, state.merchantId, "whatsapp", {
        externalId: phoneId,
        accessToken,
        tokenExpiresAt: expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : undefined
      });
    }

    try {
      await updateAgentStatus(state.merchantId, "social", true);
    } catch { /* non-critical */ }

    return NextResponse.redirect(
      new URL(`/integrations/callback?platform=${platform}&status=success`, req.url)
    );
  } catch (err) {
    console.error("Meta OAuth callback failed", err);
    const cause = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(new URL(`/integrations/callback?platform=${platform ?? "meta"}&status=error&error=${encodeURIComponent(cause)}`, req.url));
  }
}
