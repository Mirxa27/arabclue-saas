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
  refresh_expires_in: z.number().optional(),
  open_id: z.string().optional(),
  scope: z.string().optional()
});

/**
 * TikTok v2 OAuth token endpoint. Its success body is a flat JSON object
 * (`{ access_token, expires_in, open_id, refresh_expires_in, refresh_token, scope, token_type }`,
 * https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token, read 2026-11-06) — the
 * `{ data: … }` envelope belongs to the Content/Display APIs, not OAuth. Errors are
 * `{ error, error_description, log_id }`. Access tokens live 2 hours, refresh tokens rotate:
 * "a successful refresh request will return a new refresh_token in place of the one you sent".
 */
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/** Accepts the documented flat body (and a `data` envelope, defensively). */
function parseTokenBody(json: unknown): z.infer<typeof TokenSchema> | null {
  const direct = TokenSchema.safeParse(json);
  if (direct.success) return direct.data;
  const wrapped = z.object({ data: TokenSchema }).safeParse(json);
  return wrapped.success ? wrapped.data.data : null;
}

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
  const res = await fetch(TIKTOK_TOKEN_URL, {
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
  const body = parseTokenBody(await res.json());
  if (!body) throw new Error("TikTok token exchange returned no access token");
  return body;
}

export async function resolveTikTokOpenId(accessToken: string): Promise<string> {
  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`TikTok user info failed: ${res.status}`);
  const data = z.object({ data: z.object({ user: z.object({ open_id: z.string() }) }) }).parse(await res.json());
  return data.data.user.open_id;
}

/**
 * refresh_token grant (client_key, client_secret, grant_type, refresh_token as form fields).
 * TikTok can answer an OAuth error with HTTP 200, so the body decides. Only `invalid_grant`
 * (the refresh token is expired / spent / revoked) flags the channel for reconnection.
 */
export async function refreshTikTokToken(refreshToken: string): Promise<RefreshedTokens> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) throw new TokenRefreshError("tiktok", "TikTok app credentials are not configured");

  let json: unknown;
  let status = 200;
  try {
    const res = await postForm(
      "TikTok",
      TIKTOK_TOKEN_URL,
      { client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken },
      {},
      15_000
    );
    json = res.json;
    status = res.status;
  } catch (err) {
    if (!(err instanceof ProviderHttpError)) {
      throw new TokenRefreshError("tiktok", "TikTok token refresh did not complete", { cause: err });
    }
    json = err.json;
    status = err.status;
  }

  const body = parseTokenBody(json);
  if (body) {
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
  }
  const { error } = oauthErrorBody(json);
  throw new TokenRefreshError("tiktok", `TikTok token refresh failed: ${status}${error ? ` (${error})` : ""}`, {
    grantRejected: error === "invalid_grant",
    status
  });
}
