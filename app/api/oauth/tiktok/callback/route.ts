export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServiceSupabase } from "@/lib/db/supabase";
import { verifyOAuthState } from "@/lib/oauth/state";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import { exchangeTikTokCode, resolveTikTokOpenId } from "@/lib/tiktok/oauth";
import { updateAgentStatus } from "@/lib/agents/store-server";

const PKCE_COOKIE = "oauth_pkce_tiktok";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL("/integrations/callback?platform=tiktok&status=error&error=missing_params", req.url));
  }

  try {
    const verifier = cookies().get(PKCE_COOKIE)?.value;
    if (!verifier) throw new Error("Missing PKCE verifier");

    const state = verifyOAuthState(stateRaw);
    if (state.platform !== "tiktok") throw new Error("Invalid OAuth state platform");

    const tokens = await exchangeTikTokCode(code, verifier);
    const openId = tokens.open_id ?? (await resolveTikTokOpenId(tokens.access_token));
    const supabase = getServiceSupabase();

    await upsertSocialChannel(supabase, state.merchantId, "tiktok", {
      externalId: openId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined
    });

    try {
      await updateAgentStatus(state.merchantId, "social", true);
    } catch { /* non-critical */ }

    const res = NextResponse.redirect(new URL("/integrations/callback?platform=tiktok&status=success", req.url));
    res.cookies.delete(PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error("TikTok OAuth callback failed", err);
    const cause = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(new URL(`/integrations/callback?platform=tiktok&status=error&error=${encodeURIComponent(cause)}`, req.url));
  }
}
