import { NextResponse } from "next/server";
import { HttpError } from "@/lib/api/errors";
import { handleRouteError } from "@/lib/api/route-handler";

/**
 * handleRouteError, plus the stable `code` of a client-side HttpError (e.g. plan_required,
 * tax_profile_incomplete, invalid_otp, onboard_first) so the dashboard can react to it.
 */
export function zatcaRouteError(err: unknown, route: string): NextResponse {
  if (err instanceof HttpError && err.status < 500) {
    return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
  }
  if (err instanceof HttpError) {
    const res = handleRouteError(err, { route });
    return err.code ? NextResponse.json({ error: err.message, code: err.code }, { status: res.status }) : res;
  }
  return handleRouteError(err, { route });
}
