/**
 * Updating an employee (PATCH /api/employees/:id, PATCH /api/employees/:id/status).
 *
 * F10: every route that sets `status: 'active'` goes through `applyEmployeeUpdate`, which
 * requires the AI-employees entitlement, a paid / trialing seat and room under the plan's
 * seat limit (402 plan_required | seat_unpaid | seat_limit). SW-20: `config` is the bounded
 * persona schema. status / paused_at are service-role columns (ownership checked first).
 */
import { z } from "zod";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { EmployeeConfigSchema, resolveEmployeeConfig } from "./config-schema";
import { assertCanActivate } from "./gates";
import { countSeatedEmployees, TimeZoneSchema, WorkingHoursInputSchema } from "./route-helpers";
import type { AIEmployeeRow } from "./types";

export const EmployeeUpdateSchema = z.object({
  display_name: z.string().trim().min(2).max(64).optional(),
  avatar: z.string().max(64).optional().nullable(),
  language: z.enum(["ar", "en", "ar-en", "khaliji", "msa"]).optional(),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).optional(),
  timezone: TimeZoneSchema.optional(),
  working_hours: WorkingHoursInputSchema.optional(),
  knowledge: z.string().max(8000).optional().nullable(),
  goals: z.array(z.string().min(1).max(200)).max(8).optional(),
  status: z.enum(["active", "paused", "offboarded"]).optional(),
  config: EmployeeConfigSchema.optional()
});

export type EmployeeUpdate = z.infer<typeof EmployeeUpdateSchema>;

export async function applyEmployeeUpdate(
  merchant: Merchant,
  employee: AIEmployeeRow,
  updates: EmployeeUpdate,
  opts: { returning?: string } = {}
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = { ...updates };
  if (updates.config !== undefined) patch.config = resolveEmployeeConfig(employee.role_id, updates.config);

  if (updates.status === "active" && employee.status !== "active") {
    // Resuming re-takes a seat only when the employee had given it up (offboarded).
    const seated = await countSeatedEmployees(merchant.id);
    assertCanActivate(employee, merchant, employee.status === "offboarded" ? seated + 1 : seated);
    patch.paused_at = null;
    if (employee.status === "offboarded") patch.offboarded_at = null;
  }
  if (updates.status === "paused" && employee.status !== "paused") patch.paused_at = new Date().toISOString();
  if (updates.status === "offboarded" && employee.status !== "offboarded") patch.offboarded_at = new Date().toISOString();

  const { data, error } = await getServiceSupabase()
    .from("ai_employees")
    .update(patch)
    .eq("id", employee.id)
    .eq("merchant_id", merchant.id)
    .select(opts.returning ?? "*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update employee");
  return data as unknown as Record<string, unknown>;
}
