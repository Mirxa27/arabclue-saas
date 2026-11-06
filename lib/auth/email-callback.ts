/**
 * Completes an emailed sign-in link and turns it into a cookie session.
 *
 *   GET /auth/callback?code=…&next=…              PKCE link (Supabase's default template,
 *                                                 `emailRedirectTo` from POST /api/auth/otp).
 *                                                 Needs the code-verifier cookie, i.e. the same
 *                                                 browser that requested the link.
 *   GET /auth/confirm?token_hash=…&type=email&next=…[&redirect_to={{ .RedirectTo }}]
 *                                                 Token-hash link (our recommended email template).
 *                                                 Works in any browser, incl. mail-app webviews.
 *
 * Both routes accept both shapes. Success → session cookies + redirect to the validated
 * landing path (default /dashboard). Failure → /login?error=<stable code>; never a 500 and
 * never Supabase's own error text.
 *
 * The landing path is the `next` the sign-in was requested with when the link carries it in
 * `redirect_to` (our own `${site}/auth/callback?next=…`, see emailRedirectUrl), else the
 * template's `next`, else /dashboard.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { AuthError, EmailOtpType } from "@supabase/supabase-js";
import { createRouteHandlerSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";
import { relativeRedirect } from "@/lib/http/redirect";
import { DEFAULT_AFTER_LOGIN, DEFAULT_AFTER_SIGNUP, loginPath, safeRedirectPath } from "@/lib/auth/redirect";
import { siteOrigin } from "@/lib/auth/site-origin";
import { SIGN_IN_LIMITS, limitSignInByIp } from "@/lib/auth/sign-in-limits";
import {
  loginErrorFromAuthError,
  loginErrorFromRedirectParams,
  type LoginErrorCode
} from "@/lib/auth/login-errors";

export const EMAIL_OTP_TYPES = ["email", "magiclink", "signup", "invite", "recovery", "email_change"] as const;

const MAX_TOKEN_LENGTH = 1024;
const MAX_REDIRECT_TO_LENGTH = 4096;
const CALLBACK_PATH = "/auth/callback";

export function isEmailOtpType(value: string | null): value is EmailOtpType & (typeof EMAIL_OTP_TYPES)[number] {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function boundedParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TOKEN_LENGTH ? trimmed : null;
}

/**
 * The `next` carried inside a `redirect_to={{ .RedirectTo }}` parameter, or null.
 *
 * The template puts redirect_to LAST because Go's text/template inserts RedirectTo verbatim:
 * everything after `redirect_to=` (its own `?next=…`, already percent-encoded by
 * emailRedirectUrl) belongs to it. An escaped value is understood too. Only our own callback
 * URL on our origin counts; GoTrue's bare Site URL fallback, foreign URLs and the default
 * landings (a returning user who started on /signup must not be sent to /welcome) do not.
 */
export function nextFromRedirectTo(req: NextRequest): string | null {
  const search = req.nextUrl.search;
  const match = /[?&]redirect_to=/.exec(search);
  if (!match) return null;
  const raw = search.slice(match.index + match[0].length);
  if (!raw || raw.length > MAX_REDIRECT_TO_LENGTH) return null;

  let target: URL | null = null;
  for (const candidate of [raw, safeDecode(raw)]) {
    if (!candidate) continue;
    try {
      target = new URL(candidate);
      break;
    } catch {
      /* try the decoded form */
    }
  }
  if (!target || target.pathname !== CALLBACK_PATH) return null;
  if (target.origin !== siteOrigin(req) && target.origin !== req.nextUrl.origin) return null;

  const next = safeRedirectPath(target.searchParams.get("next"));
  return next && next !== DEFAULT_AFTER_LOGIN && next !== DEFAULT_AFTER_SIGNUP ? next : null;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Where an email link may land. Never a route handler: an email link that continued
 * straight into e.g. /api/oauth/meta/start would start connecting the visitor's
 * accounts under whatever account the link signed them into. OAuth starts land on the
 * page that offers the connect button instead (one deliberate click).
 */
export function emailLinkLandingPath(next: string): string {
  if (!next.startsWith("/api/")) return next;
  const employeeOAuth = /^\/api\/employees\/([0-9a-f-]{36})\/oauth\//i.exec(next);
  if (employeeOAuth) return `/employees/${employeeOAuth[1]}?tab=integrations`;
  if (next.startsWith("/api/oauth/") || next.startsWith("/api/salla/oauth/")) return "/integrations";
  return DEFAULT_AFTER_LOGIN;
}

/** Query flag set by /auth/switch after the user explicitly chose to switch accounts. */
export const SWITCH_CONFIRMED_PARAM = "switch";

export async function completeEmailSignIn(req: NextRequest, route: string): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const next = emailLinkLandingPath(nextFromRedirectTo(req) ?? safeRedirectPath(params.get("next")) ?? DEFAULT_AFTER_LOGIN);
  const fail = (code: LoginErrorCode) => relativeRedirect(loginPath({ error: code, next }));

  // Supabase rejected the link itself (expired, already used, …) and says so in the URL.
  const linkError = loginErrorFromRedirectParams(params);
  if (linkError) return fail(linkError);

  const code = boundedParam(params.get("code"));
  const tokenHash = boundedParam(params.get("token_hash"));
  const type = params.get("type");
  if (!code && !tokenHash) return fail("link_invalid");
  if (!code && !isEmailOtpType(type)) return fail("link_invalid");

  // Each attempt below may call GoTrue: cap them per client before Supabase is involved.
  if (await limitSignInByIp(req, "auth:verify", SIGN_IN_LIMITS.verifyPerIp)) return fail("rate_limited");

  const client = createRouteHandlerSupabase(req);
  if (!client) return fail("auth_unavailable");

  // Token-hash links work in any browser, so an emailed link can belong to anyone
  // (login CSRF). If someone is already signed in here, do not consume the link and
  // silently replace their session: show an explicit choice first (/auth/switch); the
  // link stays valid until the user decides. PKCE `code` links are bound to the browser
  // that requested them (code verifier cookie), so they skip this step.
  if (tokenHash && !code && params.get(SWITCH_CONFIRMED_PARAM) !== "1") {
    let currentUser: { id: string } | null = null;
    try {
      const { data } = await client.auth.getUser();
      currentUser = data.user;
    } catch {
      currentUser = null;
    }
    if (currentUser) {
      const switchParams = new URLSearchParams({ token_hash: tokenHash, type: type as string, next });
      return relativeRedirect(`/auth/switch?${switchParams.toString()}`);
    }
  }

  let error: AuthError | null;
  try {
    if (code) {
      ({ error } = await client.auth.exchangeCodeForSession(code));
    } else {
      ({ error } = await client.auth.verifyOtp({
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
