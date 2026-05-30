import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { getRole, priceForTier, TIER_LABELS } from "@/lib/employees/catalog";
import type { AIEmployeeRow } from "@/lib/employees/types";
import { featureGateMessage, merchantCanHireEmployee, merchantCanUseFeature } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

const HireSchema = z.object({
  role_id: z.string().min(1),
  display_name: z.string().min(2).max(64),
  avatar: z.string().max(64).optional().nullable(),
  language: z.enum(["ar", "en", "ar-en", "khaliji", "msa"]).default("ar-en"),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).default("professional"),
  timezone: z.string().default("Asia/Riyadh"),
  working_hours: z
    .object({
      mode: z.enum(["always", "business_hours", "custom"]),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      days: z.array(z.number().int().min(0).max(6))
    })
    .default({ mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] }),
  knowledge: z.string().max(8000).optional().nullable(),
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
  hire_plan: z.enum(["starter", "growth", "pro", "scale"]).default("starter"),
  config: z.record(z.unknown()).optional()
});

// ── GET /api/employees — list hired employees for the merchant ───────────────
export async function GET(): Promise<NextResponse> {
  try {
    const merchant = await requireMerchant();
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("ai_employees")
      .select("*")
      .eq("merchant_id", merchant.id)
      .order("hired_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({ employees: data ?? [] });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees" });
  }
}

// ── POST /api/employees — hire a new AI employee ─────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchant();
    const body = HireSchema.parse(await req.json());

    if (!merchantCanUseFeature(merchant, "employees")) {
      return NextResponse.json({ error: featureGateMessage("employees") }, { status: 402 });
    }

    const role = getRole(body.role_id);
    if (!role) return NextResponse.json({ error: "Unknown role_id" }, { status: 400 });

    const sb = getServerSupabase();
    const { count } = await sb
      .from("ai_employees")
      .select("id", { count: "exact", head: true })
      .eq("merchant_id", merchant.id)
      .neq("status", "offboarded");

    const hireCheck = merchantCanHireEmployee(merchant, count ?? 0);
    if (!hireCheck.allowed) {
      return NextResponse.json({ error: hireCheck.reason }, { status: 402 });
    }

    const monthlyCharge = priceForTier(role, body.hire_plan);
    const trialEndsAt = new Date(Date.now() + role.trialDays * 86400_000).toISOString();
    const payload = {
      merchant_id: merchant.id,
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
      config: body.config ?? {},
      status: "active"
    };

    const { data, error } = await sb.from("ai_employees").insert(payload).select("*").single();
    if (error || !data) throw new Error(error?.message ?? "Failed to hire employee");

    const employee = data as AIEmployeeRow;

    // Seed an initial onboarding task
    await sb.from("ai_employee_tasks").insert({
      employee_id: employee.id,
      title: `Onboarding: connect your first channel`,
      description: `Connect ${role.channels.slice(0, 2).join(" or ")} so ${employee.display_name} can start working.`,
      source: "system",
      priority: "high",
      status: "todo",
      due_at: new Date(Date.now() + 3600_000).toISOString()
    });

    // Seed a welcome conversation in the dashboard channel
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
        conversation_id: convo.id,
        role: "assistant",
        content:
          body.language === "ar" || body.language === "khaliji"
            ? `سلام! أنا ${employee.display_name}، ${role.arabicName} الجديد لديكم. جاهز أبدأ — وش أول مهمة؟`
            : `Hey! I'm ${employee.display_name}, your new ${role.name}. I'm ready to start — what's the first thing on your plate?`
      });
    }

    return NextResponse.json({
      employee,
      plan: TIER_LABELS[body.hire_plan],
      monthly_charge_halalas: monthlyCharge,
      trial_ends_at: trialEndsAt
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees" });
  }
}
