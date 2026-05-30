export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { verifyOAuthState } from "@/lib/oauth/state";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import { exchangeLinkedInCode, resolveLinkedInActorUrn } from "@/lib/linkedin/oauth";
import { updateAgentStatus } from "@/lib/agents/store-server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL("/integrations/callback?platform=linkedin&status=error&error=missing_params", req.url));
  }

  try {
    const state = verifyOAuthState(stateRaw);
    if (state.platform !== "linkedin") throw new Error("Invalid OAuth state platform");

    const tokens = await exchangeLinkedInCode(code);
    const actorUrn = await resolveLinkedInActorUrn(tokens.access_token);
    const supabase = getServiceSupabase();

    await upsertSocialChannel(supabase, state.merchantId, "linkedin", {
      externalId: actorUrn,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined
    });

    try {
      await updateAgentStatus(state.merchantId, "social", true);
    } catch { /* non-critical */ }

    return NextResponse.redirect(new URL("/integrations/callback?platform=linkedin&status=success", req.url));
  } catch (err) {
    console.error("LinkedIn OAuth callback failed", err);
    const cause = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(new URL(`/integrations/callback?platform=linkedin&status=error&error=${encodeURIComponent(cause)}`, req.url));
  }
}
