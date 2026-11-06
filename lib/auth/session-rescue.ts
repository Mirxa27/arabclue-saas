/**
 * POST /auth/session — turn implicit-flow tokens (from an old magic link's URL fragment)
 * into the normal cookie session. See lib/auth/implicit-session.ts for the browser side.
 *
 * The tokens are not trusted: auth-js `setSession` validates the access token with Supabase
 * (`GET /user`) or redeems the refresh token before any cookie is written. Requests must be
 * same-origin JSON so a third-party page cannot sign a visitor into another account.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRouteHandlerSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { reportError } from "@/lib/observability/error-reporter";
import { DEFAULT_AFTER_LOGIN, safeRedirectPath } from "@/lib/auth/redirect";
import type { LoginErrorCode } from "@/lib/auth/login-errors";

const MAX_BODY_BYTES = 16_384;

export const ImplicitSessionBodySchema = z.object({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(1024),
  next: z.string().max(2048).optional()
});

function failure(status: number, code: LoginErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status, headers: { "cache-control": "no-store" } });
}

export async function establishSessionFromTokens(req: NextRequest, route: string): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) {
    return failure(403, "session_failed", "Cross-site request rejected");
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return failure(415, "session_failed", "Expected application/json");
  }

  const limited = await enforceRateLimit(req, "auth:session", 10, 60_000);
  if (limited instanceof NextResponse) return limited;

  let body: z.infer<typeof ImplicitSessionBodySchema>;
  try {
    const parsed = ImplicitSessionBodySchema.safeParse(JSON.parse(await readTextBody(req, MAX_BODY_BYTES)));
    if (!parsed.success) return failure(400, "session_failed", "Invalid session payload");
    body = parsed.data;
  } catch (err) {
    if (err instanceof SyntaxError) return failure(400, "session_failed", "Invalid JSON");
    throw err; // e.g. HttpError 413 from readTextBody → handleRouteError
  }

  const client = createRouteHandlerSupabase(req);
  if (!client) return failure(503, "auth_unavailable", "Auth not configured");

  const { data, error } = await client.supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token
  });
  if (error || !data.session) {
    if (error && (error.status ?? 0) >= 500) reportError(error, { route, status: error.status });
    return failure(401, "session_failed", "Could not sign in with this link");
  }

  const next = safeRedirectPath(body.next) ?? DEFAULT_AFTER_LOGIN;
  return client.applyCookies(
    NextResponse.json({ ok: true, next }, { headers: { "cache-control": "no-store" } })
  );
}
