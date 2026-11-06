/**
 * Single OAuth callback for every employee-scoped provider.
 *
 * URL: GET /api/employees/oauth/callback?state=...&code=...
 *
 * Verifies the signed state, the flow cookie (same browser), the signed-in merchant and
 * employee ownership before exchanging the code; encrypts + upserts the tokens into
 * ai_employee_integrations; redirects back to the workspace with a stable outcome code.
 * See lib/employees/oauth/flow.ts.
 */
import type { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { completeEmployeeOAuth } from "@/lib/employees/oauth/flow";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    return await completeEmployeeOAuth(req);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/oauth/callback" });
  }
}
