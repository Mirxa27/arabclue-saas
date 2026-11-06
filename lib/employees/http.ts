/**
 * Coded JSON refusals for the AI-employee API routes.
 *
 * `handleRouteError` answers `{ error }` only; the employee API's documented refusals also
 * carry a stable `code` (lib/employees/api-codes.ts) and, for some codes, extra fields
 * (`billing_status`, `limit`, `dpa_version`). Routes wrap their body with
 * `catch (err) { return employeeRouteError(err, ROUTE) }`, which falls through to
 * `handleRouteError` for everything that is not one of these refusals.
 */
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/api/errors";
import { handleRouteError } from "@/lib/api/route-handler";
import type { EmployeeApiCode } from "./api-codes";

export class EmployeeApiError extends HttpError {
  readonly apiCode: EmployeeApiCode;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: EmployeeApiCode, message: string, extra: Record<string, unknown> = {}) {
    super(status, message, code);
    this.name = "EmployeeApiError";
    this.apiCode = code;
    this.extra = extra;
  }
}

/** `{ error, code, ...extra }` for an EmployeeApiError (or a coded 4xx HttpError); null otherwise. */
export function codedErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof EmployeeApiError) {
    return NextResponse.json({ error: err.message, code: err.apiCode, ...err.extra }, { status: err.status });
  }
  if (err instanceof HttpError && err.code && err.status >= 400 && err.status < 500) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return null;
}

export function employeeRouteError(err: unknown, route: string): NextResponse {
  return codedErrorResponse(err) ?? handleRouteError(err, { route });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
