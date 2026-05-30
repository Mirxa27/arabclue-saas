import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { redactIntegrationRow } from "@/lib/employees/credentials";
import type { AIEmployeeRow } from "@/lib/employees/types";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  display_name: z.string().min(2).max(64).optional(),
  avatar: z.string().max(64).optional().nullable(),
  language: z.enum(["ar", "en", "ar-en", "khaliji", "msa"]).optional(),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).optional(),
  timezone: z.string().optional(),
  working_hours: z
    .object({
      mode: z.enum(["always", "business_hours", "custom"]),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
      days: z.array(z.number().int().min(0).max(6))
    })
    .optional(),
  knowledge: z.string().max(8000).optional().nullable(),
  goals: z.array(z.string().min(1).max(200)).max(8).optional(),
  status: z.enum(["active", "paused", "offboarded"]).optional(),
  config: z.record(z.unknown()).optional()
});

async function fetchEmployeeOwned(id: string): Promise<AIEmployeeRow> {
  const merchant = await requireMerchant();
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !data) throw new Error("Employee not found");
  return data as AIEmployeeRow;
}

// ── GET /api/employees/:id ───────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employee = await fetchEmployeeOwned(ctx.params.id);
    const sb = getServerSupabase();
    const [integrations, tasks, conversations, heartbeat, actions] = await Promise.all([
      sb.from("ai_employee_integrations").select("*").eq("employee_id", employee.id),
      sb
        .from("ai_employee_tasks")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("ai_employee_conversations")
        .select("*")
        .eq("employee_id", employee.id)
        .order("last_message_at", { ascending: false })
        .limit(30),
      sb.from("ai_employee_heartbeats").select("*").eq("employee_id", employee.id).maybeSingle(),
      sb
        .from("ai_employee_actions")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    return NextResponse.json({
      employee,
      integrations: (integrations.data ?? []).map((row) =>
        redactIntegrationRow(row as { credentials?: Record<string, unknown> })
      ),
      tasks: tasks.data ?? [],
      conversations: conversations.data ?? [],
      heartbeat: heartbeat.data ?? null,
      actions: actions.data ?? []
    });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/:id" });
  }
}

// ── PATCH /api/employees/:id ─────────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employee = await fetchEmployeeOwned(ctx.params.id);
    const updates = UpdateSchema.parse(await req.json());

    const sb = getServerSupabase();
    const patch: Record<string, unknown> = { ...updates };
    if (updates.status === "paused") patch.paused_at = new Date().toISOString();
    if (updates.status === "active") patch.paused_at = null;

    const { data, error } = await sb
      .from("ai_employees")
      .update(patch)
      .eq("id", employee.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to update employee");

    return NextResponse.json({ employee: data });
  } catch (err) {
    return handleRouteError(err, { route: "PATCH /api/employees/:id" });
  }
}

// ── DELETE /api/employees/:id (off-boarding) ─────────────────────────────
export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employee = await fetchEmployeeOwned(ctx.params.id);
    const sb = getServerSupabase();
    await sb
      .from("ai_employees")
      .update({ status: "offboarded", offboarded_at: new Date().toISOString() })
      .eq("id", employee.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "DELETE /api/employees/:id" });
  }
}
