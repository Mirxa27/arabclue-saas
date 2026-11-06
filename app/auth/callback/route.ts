import type { NextRequest } from "next/server";
import { completeEmailSignIn } from "@/lib/auth/email-callback";
import { loginPath } from "@/lib/auth/redirect";
import { relativeRedirect } from "@/lib/http/redirect";
import { reportError } from "@/lib/observability/error-reporter";

export const dynamic = "force-dynamic";

const ROUTE = "GET /auth/callback";

/** PKCE `?code=` (and token-hash) landing for emailed sign-in links. */
export async function GET(req: NextRequest) {
  try {
    return await completeEmailSignIn(req, ROUTE);
  } catch (err) {
    // A browser navigation: send the user somewhere useful instead of a JSON 500.
    reportError(err, { route: ROUTE, status: 500 });
    return relativeRedirect(loginPath({ error: "unknown" }));
  }
}
