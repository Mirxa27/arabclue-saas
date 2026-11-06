/**
 * Shared pieces of the /api/employees/** route handlers (thin routes, logic in lib/).
 */
import { z } from "zod";
import { HttpError, notFound } from "@/lib/api/errors";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";
import type { Merchant } from "@/lib/types/database";
import { isUuid } from "./http";
import type { AIEmployeeRow } from "./types";

/** The signed-in merchant and one of its employees (RLS-scoped read; 404 for anything else). */
export async function requireOwnedEmployee(id: string): Promise<{ merchant: Merchant; employee: AIEmployeeRow }> {
  const merchant = await requireMerchantApi();
  if (!isUuid(id)) throw notFound("Employee");
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .maybeSingle();
  if (error || !data) throw notFound("Employee");
  return { merchant, employee: data as AIEmployeeRow };
}

/** Non-offboarded employees of the merchant; throws on a failed count (fail closed — SW-39). */
export async function countSeatedEmployees(merchantId: string): Promise<number> {
  const sb = await getServerSupabase();
  const { count, error } = await sb
    .from("ai_employees")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .neq("status", "offboarded");
  if (error || typeof count !== "number") {
    reportError(new Error(`seat count failed: ${error?.message ?? "no count"}`), { merchantId, extra: { dbCode: error?.code ?? null } });
    throw new HttpError(500, "Could not check the plan's employee seats. Try again.", "seat_count_failed");
  }
  return count;
}

const storable = (v: string) => !v.includes("\u0000");
const NUL_MESSAGE = "must not contain NUL characters";

/** ai_employees_goals_size: octet_length(goals::text) (20261106009000_employee_bounds_repair.sql). */
export const GOALS_MAX_JSON_BYTES = 16_384;

/**
 * Profile fields of hire and PATCH, kept within the ai_employees bounds (RE-6): display_name ≤ 64
 * and knowledge ≤ 8000 characters, as the database checks them; 8 goals of ≤ 200 characters
 * serialise to at most 9632 bytes of jsonb text (3-byte characters or \u00XX escapes throughout),
 * within GOALS_MAX_JSON_BYTES. PostgreSQL text cannot hold NUL, so it is refused here.
 */
export const DisplayNameSchema = z.string().trim().min(2).max(64).refine(storable, NUL_MESSAGE);
export const AvatarSchema = z.string().max(64).refine(storable, NUL_MESSAGE);
export const KnowledgeSchema = z.string().max(8000).refine(storable, NUL_MESSAGE);
export const GoalsSchema = z.array(z.string().min(1).max(200).refine(storable, NUL_MESSAGE)).max(8);

/** IANA time zone names only (Intl must accept it). */
export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown time zone");

export const WorkingHoursInputSchema = z.object({
  mode: z.enum(["always", "business_hours", "custom"]),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6)).max(7)
});
