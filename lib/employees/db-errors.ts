/**
 * Database refusals of an ai_employees write (hire RPC, activation RPC, PATCH), as API errors (RE-6).
 *
 * The API schemas are kept within the database bounds, so a CHECK violation (23514) — or a value
 * PostgreSQL cannot store at all (22P05 / 22021, e.g. a NUL character) — means the input broke a
 * bound the API did not catch. That is the client's input: 400 `invalid_employee_settings`, with
 * `field` when the constraint names one. Never the raw constraint text: it names internals and
 * its detail carries the whole failing row. Anything else is reported and answered with a stable
 * 500 message.
 */
import { HttpError } from "@/lib/api/errors";
import type { DbError } from "@/lib/db/errors";
import { reportError } from "@/lib/observability/error-reporter";
import { EmployeeApiError } from "./http";

const PG_CHECK_VIOLATION = "23514";
const PG_UNTRANSLATABLE_CHARACTER = "22P05";
const PG_CHARACTER_NOT_IN_REPERTOIRE = "22021";

/** ai_employees CHECK constraints → the API field each one bounds. */
const CONSTRAINT_FIELDS: Readonly<Record<string, string>> = {
  ai_employees_config_size: "config",
  ai_employees_knowledge_size: "knowledge",
  ai_employees_goals_size: "goals",
  ai_employees_display_name_size: "display_name",
  ai_employees_language_check: "language",
  ai_employees_tone_check: "tone"
};

/** The API field a CHECK violation is about, when its constraint is a known one. */
export function employeeSettingsField(error: DbError | null | undefined): string | null {
  const name = /constraint "([A-Za-z0-9_]+)"/.exec(error?.message ?? "")?.[1];
  return name && Object.hasOwn(CONSTRAINT_FIELDS, name) ? CONSTRAINT_FIELDS[name] : null;
}

export const INVALID_EMPLOYEE_SETTINGS_MESSAGE =
  "Some of the employee's settings are too long or contain characters that cannot be stored. Shorten them and try again.";

/** The database refused the input itself (a bound, or a character it cannot store). */
function isInputRefusal(code: string): boolean {
  return code === PG_CHECK_VIOLATION || code === PG_UNTRANSLATABLE_CHARACTER || code === PG_CHARACTER_NOT_IN_REPERTOIRE;
}

/**
 * The error to throw for a failed ai_employee_tasks write through the tasks API: the API keeps
 * title / description within ai_employee_tasks_{title,description}_size, so an input refusal is a
 * 400 invalid_request; anything else a reported, stable 500.
 */
export function taskWriteError(error: DbError, action: string, merchantId?: string): HttpError {
  const code = error.code ?? "";
  if (isInputRefusal(code)) {
    return new HttpError(400, "The task is too long or contains characters that cannot be stored.", "invalid_request");
  }
  reportError(new Error(`${action}: ${error.message ?? "unknown database error"}`), { merchantId, extra: { dbCode: code || null } });
  return new HttpError(500, `${action} failed`, "task_write_failed");
}

/** The error to throw for a failed ai_employees write (`action` names it in reports only). */
export function employeeWriteError(error: DbError, action: string, merchantId?: string): HttpError {
  const code = error.code ?? "";
  if (isInputRefusal(code)) {
    const field = code === PG_CHECK_VIOLATION ? employeeSettingsField(error) : null;
    // The API's own validation should have caught this: report it (code and field only — never the row).
    reportError(new Error(`${action}: the database refused the input (${code}${field ? `, ${field}` : ""})`), {
      merchantId,
      extra: { dbCode: code, field }
    });
    return new EmployeeApiError(400, "invalid_employee_settings", INVALID_EMPLOYEE_SETTINGS_MESSAGE, field ? { field } : {});
  }
  reportError(new Error(`${action}: ${error.message ?? "unknown database error"}`), { merchantId, extra: { dbCode: code || null } });
  return new HttpError(500, `${action} failed`, "employee_write_failed");
}
