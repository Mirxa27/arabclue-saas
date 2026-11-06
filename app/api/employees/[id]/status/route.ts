/**
 * Agent status toggle — activates or pauses an AI employee.
 *
 * PATCH /api/employees/[id]/status
 *   body: { status: "active" | "paused" }
 *   → { id, status, display_name, role_id, message }
 *   402 plan_required | seat_unpaid | seat_limit when activating an employee that may not run (F10).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { employeeRouteError } from "@/lib/employees/http";
import { applyEmployeeUpdate } from "@/lib/employees/manage";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const StatusSchema = z.object({
  status: z.enum(["active", "paused"])
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const { merchant, employee } = await requireOwnedEmployee(id);
    const limited = await enforceRateLimit(req, "employees:status-toggle", 15, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const body = StatusSchema.parse(await req.json());
    const data = await applyEmployeeUpdate(merchant, employee, { status: body.status }, {
      returning: "id, status, display_name, role_id"
    });
    const label = (data.display_name as string | null) ?? (data.role_id as string | null) ?? id;
    return NextResponse.json({
      ...data,
      message: body.status === "active" ? `${label} is now active` : `${label} is now paused`
    });
  } catch (err) {
    return employeeRouteError(err, "PATCH /api/employees/:id/status");
  }
}
