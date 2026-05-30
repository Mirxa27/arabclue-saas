import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";

export const dynamic = "force-dynamic";

const TaskCreateSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_at: z.string().datetime().optional().nullable()
});

const TaskUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "canceled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional().nullable()
});

async function assertEmployeeOwned(id: string): Promise<string> {
  const merchant = await requireMerchant();
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("id")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !data) throw new Error("Employee not found");
  return data.id as string;
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const sb = getServerSupabase();
    const { data } = await sb
      .from("ai_employee_tasks")
      .select("*")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/:id/tasks" });
  }
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const body = TaskCreateSchema.parse(await req.json());
    const sb = getServerSupabase();
    const { data, error } = await sb
      .from("ai_employee_tasks")
      .insert({
        employee_id: employeeId,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        due_at: body.due_at ?? null,
        source: "user",
        status: "todo"
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to create task");
    return NextResponse.json({ task: data });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/:id/tasks" });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const body = TaskUpdateSchema.parse(await req.json());
    const sb = getServerSupabase();
    const patch: Record<string, unknown> = { ...body };
    delete patch.id;
    if (body.status === "done") patch.completed_at = new Date().toISOString();
    if (body.status === "in_progress") patch.started_at = new Date().toISOString();
    const { data, error } = await sb
      .from("ai_employee_tasks")
      .update(patch)
      .eq("id", body.id)
      .eq("employee_id", employeeId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to update task");
    return NextResponse.json({ task: data });
  } catch (err) {
    return handleRouteError(err, { route: "PATCH /api/employees/:id/tasks" });
  }
}
