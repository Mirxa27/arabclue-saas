/**
 * POST /api/auth/otp — email a sign-in (or sign-up) link.
 *
 * Uses the @supabase/ssr server client bound to this request/response, so the request runs
 * the PKCE flow: auth-js stores the code verifier in a cookie on *this* response and the
 * emailed link comes back to /auth/callback?code=…, which exchanges it for a session.
 * (With the recommended token-hash email template the link goes to /auth/confirm instead
 * and needs no cookie at all.)
 *
 * The client sends an optional relative `next` path; it is validated here and is the only
 * part of the redirect the client controls. Responses carry a stable `code` the login page
 * maps to fixed Arabic + English text (`cross_site` when the same-origin check fails).
 * Requests are capped per client IP and per address (lib/auth/sign-in-limits.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRouteHandlerSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { describeOriginCheck, isSameOriginRequest } from "@/lib/security/same-origin";
import { reportError } from "@/lib/observability/error-reporter";
import { DEFAULT_AFTER_LOGIN, DEFAULT_AFTER_SIGNUP, safeRedirectPath } from "@/lib/auth/redirect";
import { siteOrigin } from "@/lib/auth/site-origin";
import { SIGN_IN_LIMITS, limitSignInByEmail, limitSignInByIp } from "@/lib/auth/sign-in-limits";
import { loginErrorFromAuthError, LOGIN_ERROR_MESSAGES, type LoginErrorCode } from "@/lib/auth/login-errors";

const MAX_BODY_BYTES = 8_192;

export const OtpRequestSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  mode: z.enum(["login", "signup"]).default("login"),
  name: z.string().trim().min(1).max(120).optional(),
  /** Same-origin path to land on after sign-in. Absolute URLs are ignored. */
  next: z.string().max(2048).optional()
});

export type OtpRequest = z.infer<typeof OtpRequestSchema>;

function otpError(status: number, code: LoginErrorCode): NextResponse {
  return NextResponse.json(
    { error: LOGIN_ERROR_MESSAGES[code].en, code },
    { status, headers: { "cache-control": "no-store" } }
  );
}

const STATUS_FOR: Partial<Record<LoginErrorCode, number>> = {
  rate_limited: 429,
  invalid_email: 400,
  signup_disabled: 403,
  account_blocked: 403,
  auth_unavailable: 503
};

/** `${origin}/auth/callback?next=<safe path>` — the URL Supabase redirects PKCE links to. */
export function emailRedirectUrl(origin: string, mode: OtpRequest["mode"], next: string | undefined): string {
  const target = safeRedirectPath(next) ?? (mode === "signup" ? DEFAULT_AFTER_SIGNUP : DEFAULT_AFTER_LOGIN);
  return `${origin}/auth/callback?next=${encodeURIComponent(target)}`;
}

export async function requestEmailOtp(req: NextRequest, route: string): Promise<NextResponse> {
  // Only our own pages call this (fetch, JSON). A cross-site form post could otherwise plant
  // a PKCE code verifier for someone else's sign-in in the visitor's browser (login CSRF).
  // Reported with what the check saw: on a misconfigured proxy every sign-in lands here.
  if (!isSameOriginRequest(req)) {
    reportError(new Error("Sign-in request rejected by the same-origin check"), {
      route,
      status: 403,
      extra: describeOriginCheck(req)
    });
    return otpError(403, "cross_site");
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Expected application/json", code: "unknown" }, { status: 415 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readTextBody(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON", code: "unknown" }, { status: 400 });
    throw err;
  }
  const parsed = OtpRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return emailIssue
      ? otpError(400, "invalid_email")
      : NextResponse.json({ error: "Invalid request", code: "unknown" }, { status: 400 });
  }
  const body = parsed.data;
  const email = body.email.toLowerCase();

  // Per client (trusted IP, see clientIp) across all addresses, then per address across all
  // clients — see lib/auth/sign-in-limits.ts.
  const limited =
    (await limitSignInByIp(req, "auth:otp:ip", SIGN_IN_LIMITS.otpPerIp)) ?? (await limitSignInByEmail(req, email));
  if (limited) return limited;

  const client = createRouteHandlerSupabase(req);
  if (!client) return otpError(503, "auth_unavailable");

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      data: body.mode === "signup" && body.name ? { full_name: body.name } : undefined,
      emailRedirectTo: emailRedirectUrl(siteOrigin(req), body.mode, body.next)
    }
  });

  if (error) {
    const code = loginErrorFromAuthError(error);
    if (code === "unknown" || code === "auth_unavailable") {
      reportError(error, { route, status: error.status, extra: { authCode: error.code } });
    }
    return otpError(STATUS_FOR[code] ?? 400, code);
  }

  // The PKCE code-verifier cookie rides on this response.
  return client.applyCookies(NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } }));
}
