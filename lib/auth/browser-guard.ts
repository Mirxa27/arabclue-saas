/**
 * Session guard for route handlers that are *browser navigations* (OAuth start links),
 * not fetch() APIs: a signed-out visitor is sent to /login?next=<this URL> and comes back
 * here after signing in; a user without a merchant profile is sent to onboarding.
 */
import type { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { Merchant } from "@/lib/types/database";
import { getSessionContext } from "@/lib/auth/session";
import { loginPath } from "@/lib/auth/redirect";
import { relativeRedirect } from "@/lib/http/redirect";

export type NavigationSession =
  | { ok: true; user: User; merchant: Merchant }
  | { ok: false; response: NextResponse };

export async function requireMerchantForNavigation(req: NextRequest): Promise<NavigationSession> {
  const { user, merchant } = await getSessionContext();
  if (!user) {
    return {
      ok: false,
      response: relativeRedirect(loginPath({ next: `${req.nextUrl.pathname}${req.nextUrl.search}` }))
    };
  }
  if (!merchant) return { ok: false, response: relativeRedirect("/welcome") };
  return { ok: true, user, merchant };
}
