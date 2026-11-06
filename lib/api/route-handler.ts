import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PlatformAdminAuthError } from "@/lib/auth/admin";
import { AuthError } from "@/lib/auth/session";
import { MoyasarApiError } from "@/lib/moyasar/types";
import { reportError } from "@/lib/observability/error-reporter";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const MAX_REPORTED_ISSUES = 5;

/** "field.path: message" for the first few issues — zod 4 messages omit the field name. */
export function formatZodIssues(err: ZodError): string {
  const parts = err.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const extra = err.issues.length - MAX_REPORTED_ISSUES;
  if (extra > 0) parts.push(`(+${extra} more)`);
  return parts.join("; ");
}

export function handleRouteError(err: unknown, context?: { route?: string }) {
  if (err instanceof ZodError) {
    return jsonError(formatZodIssues(err), 400);
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
