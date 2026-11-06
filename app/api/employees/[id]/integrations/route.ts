import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { notFound } from "@/lib/api/errors";
import { boundedRecord } from "@/lib/api/zod-bounds";
import { metaWebhookUrl, prepareIntegrationConnect } from "@/lib/employees/connect";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  redactIntegrationRow
} from "@/lib/employees/credentials";

export const dynamic = "force-dynamic";

const KIND_VALUES = [
  "whatsapp",
  "telegram",
  "slack",
  "email",
  "gmail",
  "webhook",
  "salla",
  "shopify",
  "stripe",
  "moyasar",
  "zatca",
  "meta",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "gcal",
  "outlook_calendar",
  "notion",
  "google_drive",
  "hubspot",
  "intercom",
  "zendesk",
  "twilio_voice",
  "twilio_sms",
  "github",
  "jira",
  "quickbooks",
  "xero",
  "mailchimp",
  "google_ads",
  "google_analytics"
] as const;

const ConnectSchema = z.object({
  kind: z.enum(KIND_VALUES),
  external_id: z.string().max(200).optional().nullable(),
  credentials: boundedRecord(50, z.string().max(64), z.unknown()).default({}),
  config: boundedRecord(50, z.string().max(64), z.unknown()).default({})
});

async function assertEmployeeOwned(id: string): Promise<string> {
  const merchant = await requireMerchantApi();
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("id")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !data) throw notFound("Employee");
  return data.id as string;
}

// GET /api/employees/:id/integrations
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned((await ctx.params).id);
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("ai_employee_integrations")
      .select("id, employee_id, kind, external_id, config, status, last_event_at, created_at")
      .eq("employee_id", employeeId);
    return NextResponse.json({
      integrations: (data ?? []).map((row) => redactIntegrationRow(row as { credentials?: Record<string, unknown> }))
    });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/:id/integrations" });
  }
}

// POST /api/employees/:id/integrations — connect/upsert
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned((await ctx.params).id);
    const body = ConnectSchema.parse(await req.json());
    const sb = await getServerSupabase();

    let existingCredentials: Record<string, unknown> | undefined;
    if (body.kind === "instagram") {
      const { data: existing } = await sb
        .from("ai_employee_integrations")
        .select("credentials")
        .eq("employee_id", employeeId)
        .eq("kind", body.kind)
        .maybeSingle();
      if (existing) existingCredentials = decryptIntegrationCredentials(existing.credentials as Record<string, unknown>);
    }

    // Per-kind validation and side effects (Meta ownership proof + Page subscription,
    // Telegram setWebhook) — lib/employees/connect.ts.
    const prepared = await prepareIntegrationConnect(employeeId, body, { existingCredentials });

    const payload = {
      employee_id: employeeId,
      kind: body.kind,
      external_id: prepared.external_id,
      credentials: encryptIntegrationCredentials(prepared.credentials),
      config: prepared.config,
      status: "connected" as const
    };

    const { data, error } = await sb
      .from("ai_employee_integrations")
      .upsert(payload, { onConflict: "employee_id,kind" })
      .select("id, employee_id, kind, external_id, config, status, last_event_at, created_at")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Failed to save integration");
    const webhookUrl = body.kind === "meta" || body.kind === "instagram" ? metaWebhookUrl(employeeId) : null;
    return NextResponse.json({
      integration: redactIntegrationRow(data as { credentials?: Record<string, unknown> }),
      ...(webhookUrl ? { webhook_url: webhookUrl } : {})
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/:id/integrations" });
  }
}

// DELETE /api/employees/:id/integrations?kind=... — disconnect
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned((await ctx.params).id);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
    const sb = await getServerSupabase();
    await sb.from("ai_employee_integrations").delete().eq("employee_id", employeeId).eq("kind", kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "DELETE /api/employees/:id/integrations" });
  }
}
