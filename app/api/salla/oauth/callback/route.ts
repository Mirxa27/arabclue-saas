import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/salla/oauth";
import { getServerSupabase } from "@/lib/db/supabase";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(new URL("/?install=error", req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens({
      clientId: process.env.SALLA_CLIENT_ID!,
      clientSecret: process.env.SALLA_CLIENT_SECRET!,
      redirectUri: process.env.SALLA_REDIRECT_URI!,
      code
    });

    // TODO: identify merchant from tokens or follow-up /admin/v2/store/info call
    const supabase = getServerSupabase();
    await supabase.from("merchants").upsert({
      salla_state: state,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      installed_at: new Date().toISOString()
    });

    return NextResponse.redirect(new URL("/dashboard?installed=1", req.url));
  } catch (e) {
    console.error("Salla OAuth callback failed", e);
    return NextResponse.redirect(new URL("/?install=error", req.url));
  }
}
