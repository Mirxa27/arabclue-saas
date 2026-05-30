import { z } from "zod";
import { oauthCallbackUri } from "@/lib/oauth/redirect-uri";

const TokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional()
});

export function xRedirectUri(): string {
  return process.env.X_REDIRECT_URI ?? oauthCallbackUri("/api/oauth/x/callback");
}

export function buildXAuthorizeURL(opts: {
  clientId: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: xRedirectUri(),
    scope: "tweet.read tweet.write users.read offline.access",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256"
  });
  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeXCode(code: string, codeVerifier: string): Promise<z.infer<typeof TokenSchema>> {
  const clientId = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: xRedirectUri(),
      code_verifier: codeVerifier
    })
  });
  if (!res.ok) throw new Error(`X token exchange failed: ${res.status}`);
  return TokenSchema.parse(await res.json());
}

export async function resolveXUserId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.twitter.com/2/users/me", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`X user lookup failed: ${res.status}`);
  const data = z.object({ data: z.object({ id: z.string() }) }).parse(await res.json());
  return data.data.id;
}
