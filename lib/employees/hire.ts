/**
 * Hiring an AI employee (POST /api/employees).
 *
 * SW-39: the seat limit is enforced atomically by hire_ai_employee() (count + insert under a
 * per-merchant row lock, service role); the JS check before it is only a fast path and a
 * failed count fails closed. SW-20: `config` is the bounded persona schema, and a catalog
 * persona is filled from the catalog on the server.
 */
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { featureGateMessage, employeeLimitForPlan, merchantCanHireEmployee, merchantCanUseFeature } from "@/lib/billing/entitlements";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { getRole, priceForTier, TIER_LABELS } from "./catalog";
import { EmployeeConfigSchema, resolveEmployeeConfig } from "./config-schema";
import { EmployeeApiError } from "./http";
import { countSeatedEmployees, TimeZoneSchema, WorkingHoursInputSchema } from "./route-helpers";
import type { AIEmployeeRow } from "./types";

export const HireSchema = z.object({
  role_id: z.string().min(1).max(64),
  display_name: z.string().trim().min(2).max(64),
  avatar: z.string().max(64).optional().nullable(),
  language: z.enum(["ar", "en", "ar-en", "khaliji", "msa"]).default("ar-en"),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).default("professional"),
  timezone: TimeZoneSchema.default("Asia/Riyadh"),
  working_hours: WorkingHoursInputSchema.default({ mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] }),
  knowledge: z.string().max(8000).optional().nullable(),
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
  hire_plan: z.enum(["starter", "growth", "pro", "scale"]).default("starter"),
  config: EmployeeConfigSchema.optional()
});

export type HireInput = z.infer<typeof HireSchema>;

export type HireResult = {
  employee: AIEmployeeRow;
  plan: (typeof TIER_LABELS)[keyof typeof TIER_LABELS];
  monthly_charge_halalas: number;
  trial_ends_at: string;
};

type HireOutcome =
  | { outcome: "hired"; employee: AIEmployeeRow }
  | { outcome: "seat_limit"; count: number }
  | { outcome: "duplicate" }
  | { outcome: "merchant_not_found" };

export async function hireEmployee(merchant: Merchant, body: HireInput): Promise<HireResult> {
  if (!merchantCanUseFeature(merchant, "employees")) {
    throw new EmployeeApiError(402, "plan_required", featureGateMessage("employees"));
  }
  const role = getRole(body.role_id);
  if (!role) throw new HttpError(400, "Unknown role_id", "unknown_role");

  const limit = employeeLimitForPlan(merchant.plan ?? "lite");
  // Fast path only (the RPC below is the real check); a failed count refuses the hire.
  const current = await countSeatedEmployees(merchant.id);
  const pre = merchantCanHireEmployee(merchant, current);
  if (!pre.allowed) throw new EmployeeApiError(402, "seat_limit", pre.reason ?? "Seat limit reached", { limit });

  const monthlyCharge = priceForTier(role, body.hire_plan);
  const trialEndsAt = new Date(Date.now() + role.trialDays * 86400_000).toISOString();
  const row = {
    role_id: role.id,
    display_name: body.display_name,
    avatar: body.avatar ?? role.emoji,
    language: body.language,
    tone: body.tone,
    timezone: body.timezone,
    working_hours: body.working_hours,
    knowledge: body.knowledge ?? null,
    goals: body.goals,
    hire_plan: body.hire_plan,
    monthly_charge_halalas: monthlyCharge,
    trial_ends_at: trialEndsAt,
    billing_status: "trial",
    config: resolveEmployeeConfig(role.id, body.config),
    status: "active"
  };

  // Hiring writes billing columns (price, trial, billing_status): service role only.
  const { data, error } = await getServiceSupabase().rpc("hire_ai_employee", {
    p_merchant_id: merchant.id,
    p_limit: limit,
    p_row: row
  });
  if (error) throw new Error(`hire failed: ${error.message}`);
  const result = data as HireOutcome | null;
  switch (result?.outcome) {
    case "hired":
      break;
    case "seat_limit":
      throw new EmployeeApiError(
        402,
        "seat_limit",
        `Your ${merchant.plan} plan includes up to ${limit} AI employees. Upgrade or offboard someone to hire more.`,
        { limit }
      );
    case "duplicate":
      throw new EmployeeApiError(409, "duplicate_employee", "You already have an employee with this role and name. Choose another name.");
    case "merchant_not_found":
    default:
      throw new Error("hire failed: unexpected result");
  }
  const employee = result.employee;

  // Seed the onboarding step (only the merchant can connect a channel) and the welcome
  // conversation — through the merchant's own session (RLS-scoped).
  const sb = await getServerSupabase();
  await sb.from("ai_employee_tasks").insert({
    employee_id: employee.id,
    title: `Onboarding: connect your first channel`,
    description: `Connect ${role.channels.slice(0, 2).join(" or ")} so ${employee.display_name} can start working.`,
    source: "system",
    priority: "high",
    status: "todo",
    assignee: "human",
    kind: "onboarding",
    payload: { origin: "merchant" },
    due_at: new Date(Date.now() + 3600_000).toISOString()
  });

  const { data: convo } = await sb
    .from("ai_employee_conversations")
    .insert({
      employee_id: employee.id,
      channel: "dashboard",
      external_id: `dashboard:${employee.id}`,
      contact_name: merchant.seller_name ?? "Owner",
      subject: "Welcome",
      status: "open"
    })
    .select("*")
    .single();

  if (convo) {
    await sb.from("ai_employee_messages").insert({
      conversation_id: (convo as { id: string }).id,
      role: "assistant",
      content:
        body.language === "ar" || body.language === "khaliji"
          ? `سلام! أنا ${employee.display_name}، ${role.arabicName} الجديد لديكم. جاهز أبدأ — وش أول مهمة؟`
          : `Hey! I'm ${employee.display_name}, your new ${role.name}. I'm ready to start — what's the first thing on your plate?`
    });
  }

  return { employee, plan: TIER_LABELS[body.hire_plan], monthly_charge_halalas: monthlyCharge, trial_ends_at: trialEndsAt };
}
