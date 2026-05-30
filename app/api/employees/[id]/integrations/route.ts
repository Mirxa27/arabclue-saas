import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { registerTelegramWebhook } from "@/lib/employees/channels/telegram";
import {
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
  credentials: z.record(z.unknown()).default({}),
  config: z.record(z.unknown()).default({})
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

// GET /api/employees/:id/integrations
export async function GET(_req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const sb = getServerSupabase();
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
export async function POST(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const body = ConnectSchema.parse(await req.json());
    const sb = getServerSupabase();

    const baseUrl = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://arabclue.com";

    // Side effect: for Telegram, register the webhook with Telegram's servers.
    if (body.kind === "telegram") {
      const token = (body.credentials as Record<string, unknown>).bot_token as string | undefined;
      if (!token) return NextResponse.json({ error: "Telegram bot_token required" }, { status: 400 });
      const webhookUrl = `${baseUrl}/api/employees/webhooks/telegram/${employeeId}`;
      const secret = ((body.credentials as Record<string, unknown>).webhook_secret as string | undefined) ??
        Math.random().toString(36).slice(2);
      await registerTelegramWebhook({ bot_token: token, webhook_secret: secret }, webhookUrl, secret);
      (body.credentials as Record<string, unknown>).webhook_secret = secret;
    }

    const payload = {
      employee_id: employeeId,
      kind: body.kind,
      external_id: body.external_id ?? null,
      credentials: encryptIntegrationCredentials(body.credentials),
      config: body.config,
      status: "connected" as const
    };

    const { data, error } = await sb
      .from("ai_employee_integrations")
      .upsert(payload, { onConflict: "employee_id,kind" })
      .select("id, employee_id, kind, external_id, config, status, last_event_at, created_at")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Failed to save integration");
    return NextResponse.json({
      integration: redactIntegrationRow(data as { credentials?: Record<string, unknown> })
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/:id/integrations" });
  }
}

// DELETE /api/employees/:id/integrations?kind=... — disconnect
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }): Promise<NextResponse> {
  try {
    const employeeId = await assertEmployeeOwned(ctx.params.id);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
    const sb = getServerSupabase();
    await sb.from("ai_employee_integrations").delete().eq("employee_id", employeeId).eq("kind", kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "DELETE /api/employees/:id/integrations" });
  }
}
