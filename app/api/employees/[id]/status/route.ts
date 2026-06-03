/**
 * Agent status toggle — activates or pauses an AI employee.
 *
 * PATCH /api/employees/[id]/status
 *   body: { status: "active" | "paused" }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const StatusSchema = z.object({
  status: z.enum(["active", "paused"]),
});

async function assertEmployeeOwnership(employeeId: string): Promise<void> {
  const merchant = await requireMerchant();
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("id")
    .eq("id", employeeId)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !data) throw new Error("Employee not found");
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await assertEmployeeOwnership((await ctx.params).id);

    const merchant = await requireMerchant();
    const limited = await enforceRateLimit(
      req,
      "employees:status-toggle",
      15,
      60_000,
      merchant.id
    );
    if (limited instanceof NextResponse) return limited;

    const body = StatusSchema.parse(await req.json());

    const sb = await getServerSupabase();
    const { data, error } = await sb
      .from("ai_employees")
      .update({
        status: body.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (await ctx.params).id)
      .select("id, status, display_name, role_id")
      .single();

    if (error || !data)
      throw new Error(error?.message ?? "Failed to update status");

    const label =
      data.display_name ?? data.role_id ?? (await ctx.params).id;

    return NextResponse.json({
      ...data,
      message:
        body.status === "active"
          ? `${label} is now active`
          : `${label} is now paused`,
    });
  } catch (err) {
    return handleRouteError(err, {
      route: `PATCH /api/employees/${(await ctx.params).id}/status`,
    });
  }
}