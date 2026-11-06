import { NextResponse, type NextRequest } from "next/server";
import { TaskCreateSchema, TaskUpdateSchema } from "@/lib/employees/task-schemas";
import { getServerSupabase } from "@/lib/db/supabase";
import { employeeRouteError } from "@/lib/employees/http";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const sb = await getServerSupabase();
    const { data, error } = await sb
      .from("ai_employee_tasks")
      .select("*")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees/:id/tasks");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const body = TaskCreateSchema.parse(await req.json());
    const sb = await getServerSupabase();
    const { data, error } = await sb
      .from("ai_employee_tasks")
      .insert({
        employee_id: employee.id,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        due_at: body.due_at ?? null,
        source: "user",
        status: "todo",
        assignee: body.assignee,
        kind: "task",
        payload: { origin: "merchant" }
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to create task");
    return NextResponse.json({ task: data });
  } catch (err) {
    return employeeRouteError(err, "POST /api/employees/:id/tasks");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const body = TaskUpdateSchema.parse(await req.json());
    const sb = await getServerSupabase();
    const patch: Record<string, unknown> = { ...body };
    delete patch.id;
    if (body.status === "done") patch.completed_at = new Date().toISOString();
    if (body.status === "in_progress") patch.started_at = new Date().toISOString();
    const { data, error } = await sb
      .from("ai_employee_tasks")
      .update(patch)
      .eq("id", body.id)
      .eq("employee_id", employee.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Task not found", code: "not_found" }, { status: 404 });
    return NextResponse.json({ task: data });
  } catch (err) {
    return employeeRouteError(err, "PATCH /api/employees/:id/tasks");
  }
}
