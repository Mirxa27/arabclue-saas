/**
 * Rescue for magic links sent before the PKCE switch.
 *
 * Those links were requested with supabase-js's implicit flow, so Supabase redirects to
 * `…#access_token=…&refresh_token=…` (or `#error=…&error_code=…`). The server never sees a
 * fragment; the login/landing page reads it with `parseAuthFragment`, removes it from the
 * address bar and POSTs the tokens to /auth/session, which validates them with Supabase and
 * sets the cookie session. Pure module — safe to import from client components.
 */
import { loginErrorFromRedirectParams, type LoginErrorCode } from "@/lib/auth/login-errors";

export type AuthFragment =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; code: LoginErrorCode };

const MAX_FRAGMENT_LENGTH = 16_384;

export function parseAuthFragment(hash: string | null | undefined): AuthFragment | null {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw || raw.length > MAX_FRAGMENT_LENGTH) return null;

  const params = new URLSearchParams(raw);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };

  const error = loginErrorFromRedirectParams(params);
  return error ? { kind: "error", code: error } : null;
}
