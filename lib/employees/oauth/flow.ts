/**
 * Employee-scoped OAuth (Gmail, Slack, HubSpot, …) bound to the browser, merchant and
 * employee that started it.
 *
 *   GET /api/employees/[id]/oauth/[kind]/start → provider authorize URL
 *       state  = signed { employeeId, merchantId, kind, returnTo, nonce, exp }  (no secrets)
 *       cookie = httpOnly flow cookie { nonce, PKCE verifier? }
 *   GET /api/employees/oauth/callback?code&state
 *       requires cookie nonce == state.nonce, session merchant == state.merchantId and the
 *       employee to belong to that merchant — before the code is exchanged.
 *
 * Both redirect back to the workspace with `oauth=connected|error`, `oauth_kind=<kind>` and,
 * on failure, `oauth_note=<stable OAuthErrorCode>` (map it with `oauthErrorMessage`).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { relativeRedirect } from "@/lib/http/redirect";
import { reportError } from "@/lib/observability/error-reporter";
import { generatePkcePair } from "@/lib/oauth/pkce";
import { oauthFailureReport, type OAuthErrorCode } from "@/lib/oauth/errors";
import {
  OAUTH_FLOW_TTL_SEC,
  checkOAuthBinding,
  clearOAuthFlowCookie,
  newOAuthNonce,
  readOAuthFlowCookie,
  setOAuthFlowCookie
} from "@/lib/oauth/flow-cookie";
import { getOAuthProvider } from "@/lib/employees/oauth/providers";
import { createEmployeeOAuthState, verifyEmployeeOAuthState, type EmployeeOAuthState } from "@/lib/employees/oauth/state";
import { encryptIntegrationCredentials } from "@/lib/employees/credentials";
import type { IntegrationKind } from "@/lib/employees/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_ORIGIN = "http://return.invalid";

/** Must be identical for the authorize request and the token exchange. */
export function employeeOAuthRedirectUri(req: NextRequest): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || req.nextUrl.origin).replace(/\/$/, "");
  return `${base}/api/employees/oauth/callback`;
}

export function defaultEmployeeReturnTo(employeeId: string): string {
  return `/employees/${employeeId}?tab=integrations`;
}

/** Workspace URL with the outcome flags (relative, validated). */
export function employeeOAuthResultPath(
  returnTo: string | null | undefined,
  outcome: { kind?: string; error?: OAuthErrorCode }
): string {
  const url = new URL(safeRedirectPath(returnTo) ?? "/employees", PLACEHOLDER_ORIGIN);
  url.searchParams.set("oauth", outcome.error ? "error" : "connected");
  if (outcome.kind) url.searchParams.set("oauth_kind", outcome.kind);
  else url.searchParams.delete("oauth_kind");
  if (outcome.error) url.searchParams.set("oauth_note", outcome.error);
  else url.searchParams.delete("oauth_note");
  return `${url.pathname}${url.search}${url.hash}`;
}

// ─── start ──────────────────────────────────────────────────────────────────

export async function beginEmployeeOAuth(
  req: NextRequest,
  args: { merchantId: string; employeeId: string; kind: string; returnTo: string | null }
): Promise<NextResponse> {
  const returnTo = safeRedirectPath(args.returnTo) ?? defaultEmployeeReturnTo(args.employeeId);
  // Only a registry kind is echoed back in the redirect, never the raw URL segment.
  const provider = getOAuthProvider(args.kind as IntegrationKind);
  const fail = (error: OAuthErrorCode, path: string | null = returnTo) =>
    relativeRedirect(employeeOAuthResultPath(path, { kind: provider?.kind, error }));

  if (!UUID_RE.test(args.employeeId)) return fail("employee_not_found", "/employees");
  const sb = await getServerSupabase();
  const { data: emp, error } = await sb
    .from("ai_employees")
    .select("id")
    .eq("id", args.employeeId)
    .eq("merchant_id", args.merchantId)
    .maybeSingle();
  if (error || !emp) return fail("employee_not_found", "/employees");

  if (!provider) return fail("unknown_provider");
  if (!provider.clientId()) return fail("not_configured");

  const nonce = newOAuthNonce();
  const pkce = provider.usesPkce ? generatePkcePair() : undefined;
  const state = createEmployeeOAuthState({
    employeeId: args.employeeId,
    merchantId: args.merchantId,
    kind: provider.kind,
    returnTo,
    nonce,
    ttlSec: OAUTH_FLOW_TTL_SEC
  });

  const res = NextResponse.redirect(
    provider.authorizeUrl({ state, redirectUri: employeeOAuthRedirectUri(req), codeChallenge: pkce?.challenge })
  );
  res.headers.set("cache-control", "no-store");
  setOAuthFlowCookie(res, req, "employee", { nonce, codeVerifier: pkce?.verifier });
  return res;
}

// ─── callback ───────────────────────────────────────────────────────────────

const ROUTE = "GET /api/employees/oauth/callback";

export async function completeEmployeeOAuth(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const binding = readOAuthFlowCookie(req, "employee");
  let state: EmployeeOAuthState | null = null;
  let merchantId: string | undefined;

  const finish = (error?: OAuthErrorCode, detail?: unknown): NextResponse => {
    if (error && error !== "provider_denied") {
      const report = oauthFailureReport(error, detail);
      reportError(report.error, {
        route: ROUTE,
        merchantId,
        extra: {
          flow: "employee",
          code: error,
          kind: state?.kind,
          ...(report.detail === undefined ? {} : { detail: report.detail })
        }
      });
    }
    const res = relativeRedirect(employeeOAuthResultPath(state?.returnTo, { kind: state?.kind, error }));
    clearOAuthFlowCookie(res, req, "employee");
    return res;
  };

  try {
    const stateParam = params.get("state");
    if (stateParam) {
      try {
        state = verifyEmployeeOAuthState(stateParam);
      } catch {
        state = null;
      }
    }

    if (params.get("error")) return finish("provider_denied");
    const code = params.get("code");
    if (!code || !stateParam) return finish("missing_code_or_state");
    if (!state) return finish("bad_state");

    const { user, merchant } = await getSessionContext();
    merchantId = merchant?.id;
    const bindingError = checkOAuthBinding({
      binding,
      stateNonce: state.nonce,
      stateMerchantId: state.merchantId,
      signedIn: Boolean(user),
      sessionMerchantId: merchant?.id
    });
    if (bindingError) return finish(bindingError);

    // The employee must (still) belong to the signed-in merchant — RLS-scoped read.
    const userSb = await getServerSupabase();
    const { data: emp, error: empErr } = await userSb
      .from("ai_employees")
      .select("id")
      .eq("id", state.employeeId)
      .eq("merchant_id", state.merchantId)
      .maybeSingle();
    if (empErr || !emp) return finish("employee_not_found", empErr ?? undefined);

    const provider = getOAuthProvider(state.kind);
    if (!provider) return finish("unknown_provider");
    if (!provider.clientId()) return finish("not_configured");
    if (provider.usesPkce && !binding?.codeVerifier) return finish("state_mismatch");

    let tokens;
    try {
      tokens = await provider.exchange({
        code,
        redirectUri: employeeOAuthRedirectUri(req),
        codeVerifier: binding?.codeVerifier
      });
    } catch (err) {
      return finish("token_exchange_failed", err);
    }
    if (!tokens.access_token) return finish("token_exchange_failed");

    let externalId: string | null = null;
    let externalLabel: string | null = null;
    if (provider.identify) {
      try {
        const ident = await provider.identify(tokens);
        if (ident) {
          externalId = ident.externalId;
          externalLabel = ident.label;
        }
      } catch {
        // identify failures are non-fatal; we still save the tokens
      }
    }

    const credsToStore: Record<string, unknown> = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      external_label: externalLabel ?? undefined
    };
    for (const key of Object.keys(credsToStore)) {
      if (credsToStore[key] === undefined) delete credsToStore[key];
    }

    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
    const config: Record<string, unknown> = { connected_via: "oauth" };
    if (expiresAt) config.token_expires_at = expiresAt;

    const sb = getServiceSupabase();
    const { error: upsertErr } = await sb.from("ai_employee_integrations").upsert(
      {
        employee_id: state.employeeId,
        kind: state.kind,
        external_id: externalId,
        credentials: encryptIntegrationCredentials(credsToStore),
        config,
        status: "connected" as const,
        last_event_at: new Date().toISOString()
      },
      { onConflict: "employee_id,kind" }
    );
    if (upsertErr) return finish("save_failed", upsertErr);

    // Activity feed entry; the connection itself is already saved.
    const { error: logErr } = await sb.from("ai_employee_actions").insert({
      employee_id: state.employeeId,
      action: "oauth_connect",
      channel: state.kind,
      target: externalLabel ?? null,
      result: { provider: provider.label },
      status: "success"
    });
    if (logErr) reportError(logErr, { route: ROUTE, merchantId, extra: { step: "action_log" } });

    return finish();
  } catch (err) {
    return finish("unknown", err);
  }
}
