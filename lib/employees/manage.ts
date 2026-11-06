/**
 * Updating an employee (PATCH /api/employees/:id, PATCH /api/employees/:id/status).
 *
 * F10: every route that sets `status: 'active'` goes through `applyEmployeeUpdate`, which
 * requires the AI-employees entitlement, a paid / trialing seat and room under the plan's
 * seat limit (402 plan_required | seat_unpaid | seat_limit). SW-20: `config` is the bounded
 * persona schema. status / paused_at are service-role columns (ownership checked first).
 * RE-3: the switch to `active` runs in activate_ai_employee() — the seat check and the update in
 * one transaction under the same merchant row lock as hire_ai_employee(), so concurrent resumes
 * (or a resume racing a hire) cannot exceed the plan's limit. RE-6: a database refusal of the
 * row is a 400 invalid_employee_settings, never the raw constraint text.
 */
import { z } from "zod";
import { HttpError, notFound } from "@/lib/api/errors";
import { employeeLimitForPlan } from "@/lib/billing/entitlements";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { EmployeeConfigSchema, resolveEmployeeConfig } from "./config-schema";
import { employeeWriteError } from "./db-errors";
import {
  assertCanActivate,
  employeeSeatStanding,
  seatLimitOnResumeError,
  seatUnpaidOnResumeError,
  type SeatUnpaidReason
} from "./gates";
import {
  AvatarSchema,
  countSeatedEmployees,
  DisplayNameSchema,
  GoalsSchema,
  KnowledgeSchema,
  TimeZoneSchema,
  WorkingHoursInputSchema
} from "./route-helpers";
import type { AIEmployeeRow } from "./types";

export const EmployeeUpdateSchema = z.object({
  display_name: DisplayNameSchema.optional(),
  avatar: AvatarSchema.optional().nullable(),
  language: z.enum(["ar", "en", "ar-en", "khaliji", "msa"]).optional(),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).optional(),
  timezone: TimeZoneSchema.optional(),
  working_hours: WorkingHoursInputSchema.optional(),
  knowledge: KnowledgeSchema.optional().nullable(),
  goals: GoalsSchema.optional(),
  status: z.enum(["active", "paused", "offboarded"]).optional(),
  config: EmployeeConfigSchema.optional()
});

export type EmployeeUpdate = z.infer<typeof EmployeeUpdateSchema>;

/** activate_ai_employee() outcomes (supabase/migrations/20261106009100_employee_activation.sql). */
type ActivationOutcome =
  | { outcome: "activated"; employee: AIEmployeeRow }
  | { outcome: "seat_limit"; count: number }
  | {
      outcome: "seat_unpaid";
      billing_status: AIEmployeeRow["billing_status"];
      trial_ends_at: string | null;
      next_billing_at: string | null;
    }
  | { outcome: "employee_not_found" }
  | { outcome: "merchant_not_found" };

/** `row` narrowed to a PostgREST-style column list ("id, status"); the whole row for "*" or none. */
function selectColumns(row: Record<string, unknown>, columns?: string): Record<string, unknown> {
  if (!columns || columns.trim() === "*") return row;
  const out: Record<string, unknown> = {};
  for (const column of columns.split(",").map((c) => c.trim()).filter(Boolean)) out[column] = row[column];
  return out;
}

/**
 * Switch the employee to `active` together with the rest of the update (`profile`: the
 * non-status fields only — the function ignores anything else), atomically (RE-3).
 */
async function activateEmployee(
  merchant: Merchant,
  employee: AIEmployeeRow,
  profile: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const limit = employeeLimitForPlan(merchant.plan ?? "lite");
  const { data, error } = await getServiceSupabase().rpc("activate_ai_employee", {
    p_merchant_id: merchant.id,
    p_employee_id: employee.id,
    p_limit: limit,
    p_patch: profile
  });
  if (error) throw employeeWriteError(error, "Activate employee", merchant.id);
  const result = data as ActivationOutcome | null;
  switch (result?.outcome) {
    case "activated":
      return result.employee as unknown as Record<string, unknown>;
    case "seat_limit":
      throw seatLimitOnResumeError(merchant, limit);
    case "seat_unpaid": {
      // The database decided at its own clock; name the reason from the row it saw.
      const standing = employeeSeatStanding(result);
      const reason: SeatUnpaidReason = !standing.paid
        ? standing.reason
        : result.billing_status === "trial"
          ? "trial_ended"
          : result.billing_status === "canceled"
            ? "canceled"
            : "past_due";
      throw seatUnpaidOnResumeError(result, reason);
    }
    case "employee_not_found":
    case "merchant_not_found":
      throw notFound("Employee");
    default:
      throw new HttpError(500, "Activate employee failed", "employee_write_failed");
  }
}

export async function applyEmployeeUpdate(
  merchant: Merchant,
  employee: AIEmployeeRow,
  updates: EmployeeUpdate,
  opts: { returning?: string } = {}
): Promise<Record<string, unknown>> {
  const { status, ...fields } = updates;
  const profile: Record<string, unknown> = { ...fields };
  if (fields.config !== undefined) profile.config = resolveEmployeeConfig(employee.role_id, fields.config);

  if (status === "active" && employee.status !== "active") {
    // Fast path with the detailed refusals: plan, paid seat, and the seat count (a failed count
    // refuses). Resuming re-takes a seat only when the employee had given it up (offboarded).
    const seated = await countSeatedEmployees(merchant.id);
    assertCanActivate(employee, merchant, employee.status === "offboarded" ? seated + 1 : seated);
    // The authoritative check and the switch: one transaction under the merchant lock.
    return selectColumns(await activateEmployee(merchant, employee, profile), opts.returning);
  }

  const patch: Record<string, unknown> = { ...profile };
  if (status !== undefined) patch.status = status;
  if (status === "paused" && employee.status !== "paused") patch.paused_at = new Date().toISOString();
  if (status === "offboarded" && employee.status !== "offboarded") patch.offboarded_at = new Date().toISOString();

  const { data, error } = await getServiceSupabase()
    .from("ai_employees")
    .update(patch)
    .eq("id", employee.id)
    .eq("merchant_id", merchant.id)
    .select(opts.returning ?? "*")
    .maybeSingle();
  if (error) throw employeeWriteError(error, "Update employee", merchant.id);
  if (!data) throw notFound("Employee");
  return data as unknown as Record<string, unknown>;
}
