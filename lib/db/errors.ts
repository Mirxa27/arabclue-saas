/**
 * Postgres / PostgREST error helpers for Supabase query results.
 *
 * supabase-js resolves `{ data, error }` instead of throwing; these keep the
 * error-code checks in one place so routes map them to stable HTTP errors and the
 * raw database text stays in the server logs.
 */
import { HttpError } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/error-reporter";

export type DbError = { code?: string | null; message?: string | null; details?: string | null };

/** unique_violation — e.g. a second merchant for the same user, a routing key already taken. */
export const PG_UNIQUE_VIOLATION = "23505";
/** insufficient_privilege — missing grant or a row-level-security check failure. */
export const PG_INSUFFICIENT_PRIVILEGE = "42501";

export function isUniqueViolation(error: DbError | null | undefined): boolean {
  return error?.code === PG_UNIQUE_VIOLATION;
}

/** True when the unique violation came from the named constraint/index. */
export function isUniqueViolationOn(error: DbError | null | undefined, constraint: string): boolean {
  if (!isUniqueViolation(error)) return false;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return text.includes(constraint);
}

/**
 * Fail loudly on a write error instead of letting the request "succeed": reports the
 * database detail server-side and throws a 500 HttpError with a stable message/code.
 */
export function assertNoDbError(
  error: DbError | null | undefined,
  action: string,
  context: { route?: string; merchantId?: string; code?: string } = {}
): void {
  if (!error) return;
  reportError(new Error(`${action}: ${error.message ?? "unknown database error"}`), {
    route: context.route,
    merchantId: context.merchantId,
    extra: { dbCode: error.code ?? null }
  });
  throw new HttpError(500, `${action} failed`, context.code ?? "db_write_failed");
}
