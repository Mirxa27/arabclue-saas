import type { NextRequest } from "next/server";
import { completeEmailSignIn } from "@/lib/auth/email-callback";
import { loginPath } from "@/lib/auth/redirect";
import { relativeRedirect } from "@/lib/http/redirect";
import { reportError } from "@/lib/observability/error-reporter";

export const dynamic = "force-dynamic";

const ROUTE = "GET /auth/confirm";

/**
 * Token-hash landing. Magic Link template:
 * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard&redirect_to={{ .RedirectTo }}`
 * (redirect_to last; it carries the `next` the sign-in was requested with — see
 * lib/auth/email-callback.ts). Needs no prior cookie, so it works when the mail app opens
 * the link in another browser.
 */
export async function GET(req: NextRequest) {
  try {
    return await completeEmailSignIn(req, ROUTE);
  } catch (err) {
    reportError(err, { route: ROUTE, status: 500 });
    return relativeRedirect(loginPath({ error: "unknown" }));
  }
}
