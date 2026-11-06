/**
 * Start + callback plumbing shared by the merchant-level OAuth flows
 * (LinkedIn, Meta, TikTok, X and Salla).
 *
 * Start:    signed state with a fresh nonce → provider; nonce (+ PKCE verifier) → flow cookie.
 * Callback: provider error / missing params / bad state / browser + merchant binding are all
 *           checked *before* the code is exchanged; every outcome redirects to
 *           /integrations/callback with a stable code, and the flow cookie is cleared.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { Platform } from "@/lib/social/types";
import { getSessionContext } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { relativeRedirect } from "@/lib/http/redirect";
import { reportError } from "@/lib/observability/error-reporter";
import { generatePkcePair } from "@/lib/oauth/pkce";
import { createOAuthState, verifyOAuthState, type OAuthStatePayload } from "@/lib/oauth/state";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import { OAuthCallbackError, oauthFailureReport, type OAuthErrorCode } from "@/lib/oauth/errors";
import { oauthResultPath, type OAuthResultPlatform } from "@/lib/oauth/result";
import {
  OAUTH_FLOW_TTL_SEC,
  checkOAuthBinding,
  clearOAuthFlowCookie,
  newOAuthNonce,
  readOAuthFlowCookie,
  setOAuthFlowCookie,
  type OAuthFlow
} from "@/lib/oauth/flow-cookie";
import { updateAgentStatus } from "@/lib/agents/store-server";

type StatePlatform = OAuthStatePayload["platform"];

/** Trimmed value of an env var, or undefined when unset/blank. */
export function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** True when every named env var is set (app credentials for a provider). */
export function envConfigured(...names: string[]): boolean {
  return names.every((name) => Boolean(envValue(name)));
}

// ─── start ──────────────────────────────────────────────────────────────────

export function beginOAuthFlow(
  req: Request,
  opts: {
    flow: OAuthFlow;
    merchantId: string;
    platform: StatePlatform;
    pkce?: boolean;
    authorizeUrl: (args: { state: string; codeChallenge?: string }) => string;
  }
): NextResponse {
  const nonce = newOAuthNonce();
  const pkce = opts.pkce ? generatePkcePair() : undefined;
  const state = createOAuthState({
    merchantId: opts.merchantId,
    platform: opts.platform,
    nonce,
    ttlSec: OAUTH_FLOW_TTL_SEC,
    ...(pkce ? { codeChallenge: pkce.challenge } : {})
  });
  const res = NextResponse.redirect(opts.authorizeUrl({ state, codeChallenge: pkce?.challenge }));
  res.headers.set("cache-control", "no-store");
  setOAuthFlowCookie(res, req, opts.flow, { nonce, codeVerifier: pkce?.verifier });
  return res;
}

/** Start-route failure as a browser redirect to the honest result page. */
export function oauthStartFailure(platform: OAuthResultPlatform, error: OAuthErrorCode): NextResponse {
  return relativeRedirect(oauthResultPath(platform, { ok: false, error }));
}

// ─── callback ───────────────────────────────────────────────────────────────

export type OAuthCallbackConfig<T> = {
  flow: OAuthFlow;
  route: string;
  /** State platforms this callback accepts. */
  statePlatforms: readonly StatePlatform[];
  /** Result-page platform while the state is unknown. */
  fallbackPlatform: OAuthResultPlatform;
  /** True when the provider's token endpoint needs the PKCE verifier from the flow cookie. */
  requiresCodeVerifier?: boolean;
  /** False when the platform app credentials are missing (checked before the exchange). */
  isConfigured: () => boolean;
  /** Code → provider tokens. Any throw becomes `token_exchange_failed`. */
  exchange: (args: { code: string; codeVerifier?: string; state: OAuthStatePayload }) => Promise<T>;
  /**
   * Resolve the account and store the tokens for `merchantId`. Throw OAuthCallbackError to
   * pick a code (e.g. account_lookup_failed, store_already_linked); anything else → save_failed.
   */
  persist: (args: { tokens: T; state: OAuthStatePayload; stateRaw: string; merchantId: string }) => Promise<void>;
};

export async function runOAuthCallback<T>(req: NextRequest, cfg: OAuthCallbackConfig<T>): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const binding = readOAuthFlowCookie(req, cfg.flow);
  let platform: OAuthResultPlatform = cfg.fallbackPlatform;
  let merchantId: string | undefined;

  const finish = (error?: OAuthErrorCode, detail?: unknown): NextResponse => {
    if (error && error !== "provider_denied") {
      const report = oauthFailureReport(error, detail);
      reportError(report.error, {
        route: cfg.route,
        merchantId,
        extra: { flow: cfg.flow, code: error, ...(report.detail === undefined ? {} : { detail: report.detail }) }
      });
    }
    const res = relativeRedirect(oauthResultPath(platform, error ? { ok: false, error } : { ok: true }));
    clearOAuthFlowCookie(res, req, cfg.flow);
    return res;
  };

  try {
    const code = params.get("code");
    const stateRaw = params.get("state");

    // Read the state first (when valid) so even failures name the right platform.
    let state: OAuthStatePayload | null = null;
    if (stateRaw) {
      try {
        const verified = verifyOAuthState(stateRaw);
        if (cfg.statePlatforms.includes(verified.platform)) {
          state = verified;
          platform = verified.platform as OAuthResultPlatform;
        }
      } catch {
        state = null;
      }
    }

    if (params.get("error")) return finish("provider_denied");
    if (!code || !stateRaw) return finish("missing_code_or_state");
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
    if (cfg.requiresCodeVerifier && !binding?.codeVerifier) return finish("state_mismatch");
    if (!cfg.isConfigured()) return finish("not_configured");

    let tokens: T;
    try {
      tokens = await cfg.exchange({ code, codeVerifier: binding?.codeVerifier, state });
    } catch (err) {
      return finish(err instanceof OAuthCallbackError ? err.code : "token_exchange_failed", err);
    }

    try {
      await cfg.persist({ tokens, state, stateRaw, merchantId: state.merchantId });
    } catch (err) {
      return finish(err instanceof OAuthCallbackError ? err.code : "save_failed", err);
    }

    return finish();
  } catch (err) {
    return finish("unknown", err);
  }
}

// ─── social channel persistence ─────────────────────────────────────────────

export type ProviderTokens = { accessToken: string; refreshToken?: string; expiresIn?: number };

/** Resolve the provider account id, store the encrypted tokens, enable the social agent. */
export async function persistSocialConnection(args: {
  merchantId: string;
  platform: Platform;
  tokens: ProviderTokens;
  resolveExternalId: () => Promise<string>;
}): Promise<void> {
  let externalId: string;
  try {
    externalId = await args.resolveExternalId();
  } catch (err) {
    throw new OAuthCallbackError("account_lookup_failed", err);
  }
  if (!externalId) throw new OAuthCallbackError("account_lookup_failed");

  await upsertSocialChannel(getServiceSupabase(), args.merchantId, args.platform, {
    externalId,
    accessToken: args.tokens.accessToken,
    refreshToken: args.tokens.refreshToken,
    tokenExpiresAt: args.tokens.expiresIn
      ? new Date(Date.now() + args.tokens.expiresIn * 1000).toISOString()
      : undefined
  });

  try {
    await updateAgentStatus(args.merchantId, "social", true);
  } catch {
    /* non-critical: the channel is connected either way */
  }
}
