import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { redactIntegrationRow } from "@/lib/employees/credentials";
import { employeeRouteError } from "@/lib/employees/http";
import { applyEmployeeUpdate, EmployeeUpdateSchema } from "@/lib/employees/manage";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";

export const dynamic = "force-dynamic";

// ── GET /api/employees/:id ───────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const sb = await getServerSupabase();
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
    return employeeRouteError(err, "GET /api/employees/:id");
  }
}

// ── PATCH /api/employees/:id ─────────────────────────────────────────────
// status 'active' → 402 plan_required | seat_unpaid | seat_limit (F10).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { merchant, employee } = await requireOwnedEmployee((await ctx.params).id);
    const updates = EmployeeUpdateSchema.parse(await req.json());
    const updated = await applyEmployeeUpdate(merchant, employee, updates);
    return NextResponse.json({ employee: updated });
  } catch (err) {
    return employeeRouteError(err, "PATCH /api/employees/:id");
  }
}

// ── DELETE /api/employees/:id (off-boarding) ─────────────────────────────
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { merchant, employee } = await requireOwnedEmployee((await ctx.params).id);
    // status / offboarded_at are service-role columns; ownership was checked above.
    const { error } = await getServiceSupabase()
      .from("ai_employees")
      .update({ status: "offboarded", offboarded_at: new Date().toISOString() })
      .eq("id", employee.id)
      .eq("merchant_id", merchant.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return employeeRouteError(err, "DELETE /api/employees/:id");
  }
}
