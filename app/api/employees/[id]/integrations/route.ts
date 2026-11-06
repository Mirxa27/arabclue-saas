/**
 * /api/employees/:id/integrations — see lib/employees/integrations-api.ts.
 *   GET                      → { integrations: RedactedIntegration[] }
 *   POST   { kind, credentials, config?, external_id? }   connect / replace
 *   PATCH  { kind, credentials (null removes a key), config?, external_id? }   update / finish OAuth setup
 *   DELETE ?kind=<kind>      disconnect → { ok, kind }
 * Refusals: 400 invalid_credentials | webhook_url_blocked | email_sender_required |
 * email_domain_unverified | email_sender_forbidden, 404 integration_not_found,
 * 409 dpa_required (+dpa_version), 502 provider_unavailable.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/db/supabase";
import { redactIntegrationRow } from "@/lib/employees/credentials";
import { employeeRouteError } from "@/lib/employees/http";
import {
  connectIntegration,
  ConnectSchema,
  disconnectIntegration,
  INTEGRATION_COLUMNS,
  KIND_VALUES,
  updateIntegration,
  UpdateIntegrationSchema
} from "@/lib/employees/integrations-api";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

// GET /api/employees/:id/integrations
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const sb = await getServerSupabase();
    const { data, error } = await sb.from("ai_employee_integrations").select(INTEGRATION_COLUMNS).eq("employee_id", employee.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      integrations: (data ?? []).map((row) => redactIntegrationRow(row as { credentials?: Record<string, unknown> }))
    });
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees/:id/integrations");
  }
}

// POST /api/employees/:id/integrations — connect/upsert
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { merchant, employee } = await requireOwnedEmployee((await ctx.params).id);
    const limited = await enforceRateLimit(req, "employees:integrations", 20, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const body = ConnectSchema.parse(await req.json());
    return NextResponse.json(await connectIntegration(merchant, employee.id, body));
  } catch (err) {
    return employeeRouteError(err, "POST /api/employees/:id/integrations");
  }
}

// PATCH /api/employees/:id/integrations — update credentials / finish a one-click setup
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { merchant, employee } = await requireOwnedEmployee((await ctx.params).id);
    const limited = await enforceRateLimit(req, "employees:integrations", 20, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const body = UpdateIntegrationSchema.parse(await req.json());
    return NextResponse.json(await updateIntegration(merchant, employee.id, body));
  } catch (err) {
    return employeeRouteError(err, "PATCH /api/employees/:id/integrations");
  }
}

// DELETE /api/employees/:id/integrations?kind=... — disconnect
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const kind = z.enum(KIND_VALUES).safeParse(req.nextUrl.searchParams.get("kind"));
    if (!kind.success) return NextResponse.json({ error: "kind required", code: "invalid_request" }, { status: 400 });
    return NextResponse.json(await disconnectIntegration(employee.id, kind.data));
  } catch (err) {
    return employeeRouteError(err, "DELETE /api/employees/:id/integrations");
  }
}
