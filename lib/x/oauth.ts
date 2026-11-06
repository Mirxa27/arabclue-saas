import { z } from "zod";
import { oauthCallbackUri } from "@/lib/oauth/redirect-uri";
import {
  ProviderHttpError,
  TokenRefreshError,
  oauthErrorBody,
  postForm,
  type RefreshedTokens
} from "@/lib/social/http";

const TokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional()
});

/**
 * OAuth 2.0 token endpoint as documented today
 * (https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code, read 2026-11-06).
 * Access tokens live two hours; `offline.access` adds a refresh token, and every refresh returns
 * a new one (the old one stops working), so refreshes go through lib/social/token-refresh.ts.
 */
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

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

/**
 * refresh_token grant. Confidential clients authenticate with HTTP Basic (as the code exchange
 * does); without a client secret the client id goes in the body (public client).
 *
 * grantRejected only for answers about the refresh token itself (`invalid_grant`, or X's
 * `invalid_request` "Value passed for the token was invalid"): a platform-side credential
 * problem (unauthorized_client) must not flag every merchant's channel for reconnection.
 */
export async function refreshXToken(refreshToken: string): Promise<RefreshedTokens> {
  const clientId = process.env.X_CLIENT_ID?.trim();
  const clientSecret = process.env.X_CLIENT_SECRET?.trim();
  if (!clientId) throw new TokenRefreshError("x", "X_CLIENT_ID is not configured");

  const form: Record<string, string> = { grant_type: "refresh_token", refresh_token: refreshToken };
  const headers: Record<string, string> = {};
  if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  else form.client_id = clientId;

  let json: unknown;
  try {
    ({ json } = await postForm("X", X_TOKEN_URL, form, headers, 15_000));
  } catch (err) {
    if (err instanceof ProviderHttpError) {
      const { error, description } = oauthErrorBody(err.json);
      const grantRejected =
        error === "invalid_grant" || (error === "invalid_request" && /token/i.test(description ?? ""));
      throw new TokenRefreshError("x", `X token refresh failed: ${err.status}${error ? ` (${error})` : ""}`, {
        grantRejected,
        status: err.status,
        cause: err
      });
    }
    throw new TokenRefreshError("x", "X token refresh did not complete", { cause: err });
  }

  const parsed = TokenSchema.safeParse(json);
  if (!parsed.success) throw new TokenRefreshError("x", "X token refresh returned an unexpected body");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in
  };
}
