/**
 * Start an OAuth flow to connect an integration to an employee.
 *
 * URL: GET /api/employees/[id]/oauth/[kind]/start?return_to=/employees/<id>?tab=integrations
 *
 * A browser navigation: signed-out visitors go to /login?next=<this URL>. Ownership,
 * provider config, signed state + flow cookie: see lib/employees/oauth/flow.ts.
 * The provider redirects back to /api/employees/oauth/callback?state=...&code=...
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantForNavigation } from "@/lib/auth/browser-guard";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { beginEmployeeOAuth } from "@/lib/employees/oauth/flow";

export const dynamic = "force-dynamic";

const ROUTE = "GET /api/employees/:id/oauth/:kind/start";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> }
): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "employees:oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    const session = await requireMerchantForNavigation(req);
    if (!session.ok) return session.response;

    const { id, kind } = await ctx.params;
    return await beginEmployeeOAuth(req, {
      merchantId: session.merchant.id,
      employeeId: id,
      kind,
      returnTo: req.nextUrl.searchParams.get("return_to")
    });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
