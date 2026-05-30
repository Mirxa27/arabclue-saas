/**
 * Start an OAuth flow to connect an integration to an employee.
 *
 * URL: GET /api/employees/[id]/oauth/[kind]/start
 *
 *   1. Verifies the caller owns the employee
 *   2. Resolves the provider from the registry
 *   3. Generates signed state (and PKCE if required)
 *   4. Redirects to the provider's authorize URL
 *
 * The provider will redirect back to /api/employees/oauth/callback?state=...&code=...
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getOAuthProvider } from "@/lib/employees/oauth/providers";
import { createEmployeeOAuthState } from "@/lib/employees/oauth/state";
import { generatePkcePair } from "@/lib/oauth/pkce";
import type { IntegrationKind } from "@/lib/employees/types";

export const dynamic = "force-dynamic";

function callbackUrl(req: NextRequest): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  return `${base}/api/employees/oauth/callback`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { id: string; kind: string } }
): Promise<NextResponse | Response> {
  try {
    const limited = await enforceRateLimit(req, "employees:oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const merchant = await requireMerchant();
    const sb = getServerSupabase();
    const { data: emp, error } = await sb
      .from("ai_employees")
      .select("id, merchant_id")
      .eq("id", ctx.params.id)
      .eq("merchant_id", merchant.id)
      .single();
    if (error || !emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    const kind = ctx.params.kind as IntegrationKind;
    const provider = getOAuthProvider(kind);
    if (!provider) {
      return NextResponse.json({ error: `Unknown OAuth provider: ${kind}` }, { status: 400 });
    }
    if (!provider.clientId()) {
      return NextResponse.json(
        { error: `${provider.label} OAuth is not configured. Ask the platform admin to set the env vars.` },
        { status: 503 }
      );
    }

    const url = new URL(req.url);
    const returnTo = url.searchParams.get("return_to") ?? `/employees/${emp.id}?tab=integrations`;
    const redirectUri = callbackUrl(req);

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (provider.usesPkce) {
      const pair = generatePkcePair();
      codeVerifier = pair.verifier;
      codeChallenge = pair.challenge;
    }

    const state = createEmployeeOAuthState({
      employeeId: emp.id,
      merchantId: merchant.id,
      kind,
      codeVerifier,
      returnTo,
      ttlSec: 600
    });

    const authorizeUrl = provider.authorizeUrl({ state, redirectUri, codeChallenge });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/:id/oauth/:kind/start" });
  }
}
