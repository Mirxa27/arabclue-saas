/**
 * Shared pieces of the /api/employees/** route handlers (thin routes, logic in lib/).
 */
import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
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
  if (error || typeof count !== "number") throw new Error(`seat count failed: ${error?.message ?? "no count"}`);
  return count;
}

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
