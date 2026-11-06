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
import {
  assertSendable,
  OAUTH_CHANNEL_KINDS,
  oauthChannelSetup,
  OAuthChannelSetupError,
  subscribeWhatsAppWebhooks,
  type OAuthChannelSetup,
  type SetupState
} from "@/lib/employees/oauth/channel-setup";
import { encryptIntegrationCredentials } from "@/lib/employees/credentials";
import { channelNeedsDpa } from "@/lib/employees/dpa-gate";
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

/**
 * Workspace URL with the outcome flags (relative, validated):
 *   oauth=connected | error | setup_required, oauth_kind=<kind>,
 *   oauth_note=<OAuthErrorCode> on error, oauth_setup=<SetupState> when the provider account
 *   needs a choice before it can send (finish with PATCH /api/employees/:id/integrations).
 */
export function employeeOAuthResultPath(
  returnTo: string | null | undefined,
  outcome: { kind?: string; error?: OAuthErrorCode; setup?: SetupState }
): string {
  const url = new URL(safeRedirectPath(returnTo) ?? "/employees", PLACEHOLDER_ORIGIN);
  url.searchParams.set("oauth", outcome.error ? "error" : outcome.setup ? "setup_required" : "connected");
  if (outcome.kind) url.searchParams.set("oauth_kind", outcome.kind);
  else url.searchParams.delete("oauth_kind");
  if (outcome.error) url.searchParams.set("oauth_note", outcome.error);
  else url.searchParams.delete("oauth_note");
  if (outcome.setup && !outcome.error) url.searchParams.set("oauth_setup", outcome.setup);
  else url.searchParams.delete("oauth_setup");
  return `${url.pathname}${url.search}${url.hash}`;
}

// ─── start ──────────────────────────────────────────────────────────────────

export async function beginEmployeeOAuth(
  req: NextRequest,
  args: {
    merchantId: string;
    /** merchants.dpa_version of the signed-in merchant (customer-facing channels need the current DPA). */
    merchantDpaVersion: string | null | undefined;
    employeeId: string;
    kind: string;
    returnTo: string | null;
  }
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
  if (channelNeedsDpa(provider.kind, { dpa_version: args.merchantDpaVersion ?? null })) return fail("dpa_required");

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

  const finish = (error?: OAuthErrorCode, detail?: unknown, setup?: SetupState): NextResponse => {
    if (error && error !== "provider_denied" && error !== "dpa_required") {
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
    const res = relativeRedirect(employeeOAuthResultPath(state?.returnTo, { kind: state?.kind, error, setup }));
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
    if (channelNeedsDpa(provider.kind, merchant)) return finish("dpa_required");

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

    let credsToStore: Record<string, unknown>;
    let config: Record<string, unknown> = { connected_via: "oauth" };
    let status: "connected" | "disconnected" = "connected";
    let setup: OAuthChannelSetup | null = null;

    if (OAUTH_CHANNEL_KINDS.has(state.kind)) {
      // Messaging channels: store the keys the send adapter reads (SW-7), or a pending setup.
      try {
        const email = externalLabel && externalLabel.includes("@") ? externalLabel : null;
        setup = await oauthChannelSetup(state.kind, tokens, { email });
        if (setup) setup = assertSendable(state.kind, setup);
      } catch (err) {
        if (err instanceof OAuthChannelSetupError) return finish(err.code, err);
        return finish("account_lookup_failed", err);
      }
    }

    if (setup) {
      credsToStore = setup.credentials;
      config = { ...config, ...setup.config, ...(setup.setup ? { setup: setup.setup } : {}) };
      status = setup.status === "connected" ? "connected" : "disconnected";
      if (setup.externalId) externalId = setup.externalId;
    } else {
      credsToStore = {
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
      if (expiresAt) config.token_expires_at = expiresAt;
    }

    const sb = getServiceSupabase();
    const { error: upsertErr } = await sb.from("ai_employee_integrations").upsert(
      {
        employee_id: state.employeeId,
        kind: state.kind,
        external_id: externalId,
        credentials: encryptIntegrationCredentials(credsToStore),
        config,
        status,
        last_event_at: new Date().toISOString()
      },
      { onConflict: "employee_id,kind" }
    );
    if (upsertErr) return finish("save_failed", upsertErr);

    // WhatsApp: point the WABA's webhooks at this employee now that the row (and its verify
    // token, which Meta checks against the callback) is saved. Failure is recorded, not fatal.
    if (state.kind === "whatsapp" && status === "connected") {
      const waba = typeof credsToStore.waba_id === "string" ? credsToStore.waba_id : null;
      const verifyToken = typeof credsToStore.verify_token === "string" ? credsToStore.verify_token : null;
      const accessToken = typeof credsToStore.access_token === "string" ? credsToStore.access_token : null;
      if (waba && verifyToken && accessToken) {
        const sub = await subscribeWhatsAppWebhooks({ employeeId: state.employeeId, wabaId: waba, accessToken, verifyToken });
        const { error: subErr } = await sb
          .from("ai_employee_integrations")
          .update({ config: { ...config, subscribed: sub.subscribed, ...(sub.error ? { subscribe_error: sub.error } : {}) } })
          .eq("employee_id", state.employeeId)
          .eq("kind", "whatsapp");
        if (subErr) reportError(subErr, { route: ROUTE, merchantId, extra: { step: "whatsapp_subscription" } });
      }
    }

    // Activity feed entry; the connection itself is already saved.
    const { error: logErr } = await sb.from("ai_employee_actions").insert({
      employee_id: state.employeeId,
      action: "oauth_connect",
      channel: state.kind,
      target: externalLabel ?? null,
      result: { provider: provider.label, ...(setup?.setup ? { setup_required: setup.setup.state } : {}) },
      status: status === "connected" ? "success" : "retry"
    });
    if (logErr) reportError(logErr, { route: ROUTE, merchantId, extra: { step: "action_log" } });

    return finish(undefined, undefined, setup?.setup?.state);
  } catch (err) {
    return finish("unknown", err);
  }
}
