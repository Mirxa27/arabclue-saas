/**
 * Single OAuth callback for every employee-scoped provider.
 *
 * URL: GET /api/employees/oauth/callback?state=...&code=...
 *
 * Flow:
 *   1. Verify signed state → recover employee + provider + PKCE verifier.
 *   2. Exchange the code for tokens.
 *   3. Optional: identify() to derive an external_id.
 *   4. Encrypt + upsert into ai_employee_integrations.
 *   5. Redirect back to the workspace integrations tab with a status flag.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { getOAuthProvider } from "@/lib/employees/oauth/providers";
import { verifyEmployeeOAuthState } from "@/lib/employees/oauth/state";
import { encryptIntegrationCredentials } from "@/lib/employees/credentials";

export const dynamic = "force-dynamic";

function callbackUrl(req: NextRequest): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return `${base}/api/employees/oauth/callback`;
}

function backToWorkspace(req: NextRequest, returnTo: string | undefined, status: "connected" | "error", note?: string): NextResponse {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const path = returnTo && returnTo.startsWith("/") ? returnTo : "/employees";
  const u = new URL(`${base}${path}`);
  u.searchParams.set("oauth", status);
  if (note) u.searchParams.set("oauth_note", note);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error") ?? url.searchParams.get("error_description");

    if (!stateParam) {
      return NextResponse.json({ error: "missing state" }, { status: 400 });
    }

    let state;
    try {
      state = verifyEmployeeOAuthState(stateParam);
    } catch (err) {
      return backToWorkspace(req, undefined, "error", err instanceof Error ? err.message : "bad_state");
    }

    if (oauthError) {
      return backToWorkspace(req, state.returnTo, "error", oauthError);
    }
    if (!code) {
      return backToWorkspace(req, state.returnTo, "error", "missing_code");
    }

    const provider = getOAuthProvider(state.kind);
    if (!provider) {
      return backToWorkspace(req, state.returnTo, "error", "unknown_provider");
    }

    const redirectUri = callbackUrl(req);
    const tokens = await provider.exchange({
      code,
      redirectUri,
      codeVerifier: state.codeVerifier
    });

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
    // Strip undefined to keep the encrypted blob tidy
    for (const k of Object.keys(credsToStore)) {
      if (credsToStore[k] === undefined) delete credsToStore[k];
    }

    const sb = getServiceSupabase();
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
    const config: Record<string, unknown> = { connected_via: "oauth" };
    if (expiresAt) config.token_expires_at = expiresAt;

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
    if (upsertErr) {
      return backToWorkspace(req, state.returnTo, "error", upsertErr.message);
    }

    // Log a connect action so the activity feed shows it
    await sb.from("ai_employee_actions").insert({
      employee_id: state.employeeId,
      action: "oauth_connect",
      channel: state.kind,
      target: externalLabel ?? null,
      result: { provider: provider.label },
      status: "success"
    });

    return backToWorkspace(req, state.returnTo, "connected", provider.label);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/oauth/callback" });
  }
}
