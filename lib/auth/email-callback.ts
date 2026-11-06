/**
 * Completes an emailed sign-in link and turns it into a cookie session.
 *
 *   GET /auth/callback?code=…&next=…              PKCE link (Supabase's default template,
 *                                                 `emailRedirectTo` from POST /api/auth/otp).
 *                                                 Needs the code-verifier cookie, i.e. the same
 *                                                 browser that requested the link.
 *   GET /auth/confirm?token_hash=…&type=email&next=…
 *                                                 Token-hash link (our recommended email template).
 *                                                 Works in any browser, incl. mail-app webviews.
 *
 * Both routes accept both shapes. Success → session cookies + redirect to the validated
 * `next` (default /dashboard). Failure → /login?error=<stable code>; never a 500 and never
 * Supabase's own error text.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { AuthError, EmailOtpType } from "@supabase/supabase-js";
import { createRouteHandlerSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";
import { relativeRedirect } from "@/lib/http/redirect";
import { DEFAULT_AFTER_LOGIN, loginPath, safeRedirectPath } from "@/lib/auth/redirect";
import {
  loginErrorFromAuthError,
  loginErrorFromRedirectParams,
  type LoginErrorCode
} from "@/lib/auth/login-errors";

export const EMAIL_OTP_TYPES = ["email", "magiclink", "signup", "invite", "recovery", "email_change"] as const;

const MAX_TOKEN_LENGTH = 1024;

function isEmailOtpType(value: string | null): value is EmailOtpType & (typeof EMAIL_OTP_TYPES)[number] {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function boundedParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TOKEN_LENGTH ? trimmed : null;
}

export async function completeEmailSignIn(req: NextRequest, route: string): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const next = safeRedirectPath(params.get("next")) ?? DEFAULT_AFTER_LOGIN;
  const fail = (code: LoginErrorCode) => relativeRedirect(loginPath({ error: code, next }));

  // Supabase rejected the link itself (expired, already used, …) and says so in the URL.
  const linkError = loginErrorFromRedirectParams(params);
  if (linkError) return fail(linkError);

  const code = boundedParam(params.get("code"));
  const tokenHash = boundedParam(params.get("token_hash"));
  const type = params.get("type");
  if (!code && !tokenHash) return fail("link_invalid");
  if (!code && !isEmailOtpType(type)) return fail("link_invalid");

  const client = createRouteHandlerSupabase(req);
  if (!client) return fail("auth_unavailable");

  let error: AuthError | null;
  try {
    if (code) {
      ({ error } = await client.supabase.auth.exchangeCodeForSession(code));
    } else {
      ({ error } = await client.supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash as string
      }));
    }
  } catch (err) {
    // Network failure or an unexpected throw inside auth-js.
    reportError(err, { route, status: 503 });
    return fail("auth_unavailable");
  }

  if (error) {
    const mapped = loginErrorFromAuthError(error);
    if (mapped === "unknown" || mapped === "auth_unavailable") {
      reportError(error, { route, status: error.status, extra: { authCode: error.code } });
    }
    return fail(mapped);
  }

  return client.applyCookies(relativeRedirect(next));
}
