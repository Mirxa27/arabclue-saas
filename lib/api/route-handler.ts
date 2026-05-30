import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PlatformAdminAuthError } from "@/lib/auth/admin";
import { AuthError } from "@/lib/auth/session";
import { MoyasarApiError } from "@/lib/moyasar/types";
import { reportError } from "@/lib/observability/error-reporter";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown, context?: { route?: string }) {
  if (err instanceof ZodError) {
    return jsonError(err.errors.map((e) => e.message).join("; "), 400);
  }
  if (err instanceof MoyasarApiError) {
    reportError(err, { route: context?.route, status: err.status || 500 });
    return jsonError(err.message, err.status || 500);
  }
  if (err instanceof PlatformAdminAuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof Error) {
    reportError(err, { route: context?.route, status: 500 });
    return jsonError(err.message, 500);
  }
  reportError(err, { route: context?.route, status: 500 });
  return jsonError("Internal server error", 500);
}
