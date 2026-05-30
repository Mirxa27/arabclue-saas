import { z } from "zod";
import { oauthCallbackUri } from "@/lib/oauth/redirect-uri";

const TokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  open_id: z.string().optional()
});

export function tikTokRedirectUri(): string {
  return process.env.TIKTOK_REDIRECT_URI ?? oauthCallbackUri("/api/oauth/tiktok/callback");
}

export function buildTikTokAuthorizeURL(opts: {
  clientKey: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_key: opts.clientKey,
    scope: "user.info.basic,video.publish",
    response_type: "code",
    redirect_uri: tikTokRedirectUri(),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256"
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

export async function exchangeTikTokCode(code: string, codeVerifier: string): Promise<z.infer<typeof TokenSchema>> {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: tikTokRedirectUri(),
      code_verifier: codeVerifier
    })
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${res.status}`);
  const body = z.object({ data: TokenSchema }).parse(await res.json());
  return body.data;
}

export async function resolveTikTokOpenId(accessToken: string): Promise<string> {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`TikTok user info failed: ${res.status}`);
  const data = z.object({ data: z.object({ user: z.object({ open_id: z.string() }) }) }).parse(await res.json());
  return data.data.user.open_id;
}
