/**
 * Connect / update / disconnect an employee's integrations
 * (POST / PATCH / DELETE /api/employees/:id/integrations).
 *
 *   POST    connect (or replace) a channel with manual credentials — per-kind validation and
 *           side effects in lib/employees/connect.ts; never `connected` without what the
 *           send adapter needs (SW-7).
 *   PATCH   update credentials / config of an existing row: changed keys are merged into
 *           the stored (decrypted) credentials (`null` removes a key, "" keeps it), then the
 *           kind's validation runs again; a one-click OAuth row in `config.setup` is finished
 *           here with the merchant's choice (WhatsApp number, Instagram Page) (UI-030).
 *   DELETE  remove the row (Telegram's webhook is unregistered first, best effort).
 * Customer-facing channels require the current DPA (409 dpa_required). Writes go through
 * the merchant's RLS-scoped session; credentials are encrypted at rest and never returned.
 */
import { z } from "zod";
import { boundedRecord } from "@/lib/api/zod-bounds";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { deleteTelegramWebhook } from "./channels/telegram";
import { assertSendableCredentials, metaWebhookUrl, prepareIntegrationConnect, SERVER_OWNED_CONFIG_KEYS } from "./connect";
import { decryptIntegrationCredentials, encryptIntegrationCredentials, redactIntegrationRow } from "./credentials";
import { assertDpaForChannel } from "./dpa-gate";
import { EmployeeApiError } from "./http";
import { completeOAuthChannelSetup, OAuthChannelSetupError, subscribeWhatsAppWebhooks } from "./oauth/channel-setup";
import type { IntegrationKind } from "./types";

export const KIND_VALUES = [
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
] as const satisfies readonly IntegrationKind[];

export const ConnectSchema = z.object({
  kind: z.enum(KIND_VALUES),
  external_id: z.string().max(200).optional().nullable(),
  credentials: boundedRecord(50, z.string().max(64), z.unknown()).default({}),
  config: boundedRecord(50, z.string().max(64), z.unknown()).default({})
});

export const UpdateIntegrationSchema = z.object({
  kind: z.enum(KIND_VALUES),
  external_id: z.string().max(200).optional().nullable(),
  credentials: boundedRecord(50, z.string().max(64), z.union([z.string().max(4096), z.null()])).default({}),
  config: boundedRecord(50, z.string().max(64), z.unknown()).default({})
});

export const INTEGRATION_COLUMNS = "id, employee_id, kind, external_id, config, status, last_event_at, created_at";

const notFoundIntegration = () =>
  new EmployeeApiError(404, "integration_not_found", "That integration is not set up on this employee.");

type StoredRow = {
  id: string;
  kind: IntegrationKind;
  external_id: string | null;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  status: string;
};

async function loadRow(employeeId: string, kind: IntegrationKind): Promise<StoredRow | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employee_integrations")
    .select("id, kind, external_id, credentials, config, status")
    .eq("employee_id", employeeId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredRow | null) ?? null;
}

function withoutServerKeys(config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const k of SERVER_OWNED_CONFIG_KEYS) delete out[k];
  delete out.setup;
  return out;
}

export async function connectIntegration(
  merchant: Pick<Merchant, "id" | "dpa_version">,
  employeeId: string,
  body: z.infer<typeof ConnectSchema>
): Promise<{ integration: ReturnType<typeof redactIntegrationRow>; webhook_url?: string }> {
  assertDpaForChannel(body.kind, merchant);
  let existingCredentials: Record<string, unknown> | undefined;
  if (body.kind === "instagram") {
    const existing = await loadRow(employeeId, body.kind);
    if (existing) existingCredentials = decryptIntegrationCredentials(existing.credentials ?? {});
  }

  // Per-kind validation and side effects (Meta ownership proof + Page subscription,
  // Telegram setWebhook, Resend sender check, webhook URL guard) — lib/employees/connect.ts.
  const prepared = await prepareIntegrationConnect(employeeId, body, { existingCredentials });
  assertSendableCredentials(body.kind, prepared.credentials);

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employee_integrations")
    .upsert(
      {
        employee_id: employeeId,
        kind: body.kind,
        external_id: prepared.external_id,
        credentials: encryptIntegrationCredentials(prepared.credentials),
        config: prepared.config,
        status: "connected" as const
      },
      { onConflict: "employee_id,kind" }
    )
    .select(INTEGRATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save integration");
  const webhookUrl = body.kind === "meta" || body.kind === "instagram" ? metaWebhookUrl(employeeId) : null;
  return {
    integration: redactIntegrationRow(data as { credentials?: Record<string, unknown> }),
    ...(webhookUrl ? { webhook_url: webhookUrl } : {})
  };
}

export async function updateIntegration(
  merchant: Pick<Merchant, "id" | "dpa_version">,
  employeeId: string,
  body: z.infer<typeof UpdateIntegrationSchema>
): Promise<{ integration: ReturnType<typeof redactIntegrationRow>; webhook_url?: string }> {
  const existing = await loadRow(employeeId, body.kind);
  if (!existing) throw notFoundIntegration();
  assertDpaForChannel(body.kind, merchant);

  const stored = decryptIntegrationCredentials(existing.credentials ?? {});
  const storedConfig = existing.config ?? {};
  const sb = await getServerSupabase();

  // A one-click connect waiting for the merchant's choice (SW-7).
  if (storedConfig.setup && typeof storedConfig.setup === "object") {
    let setup;
    try {
      setup = await completeOAuthChannelSetup(body.kind, { credentials: stored, config: storedConfig }, body.credentials);
    } catch (err) {
      if (err instanceof OAuthChannelSetupError) throw new EmployeeApiError(400, "invalid_credentials", err.message);
      throw err;
    }
    assertSendableCredentials(body.kind, setup.credentials);
    const config: Record<string, unknown> = { ...withoutServerKeys(storedConfig), connected_via: "oauth", ...setup.config };
    if (config.token_expires_at === undefined && storedConfig.token_expires_at) config.token_expires_at = storedConfig.token_expires_at;
    const { data, error } = await sb
      .from("ai_employee_integrations")
      .update({
        credentials: encryptIntegrationCredentials(setup.credentials),
        config,
        external_id: setup.externalId,
        status: "connected"
      })
      .eq("id", existing.id)
      .eq("employee_id", employeeId)
      .select(INTEGRATION_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Failed to save integration");
    let row = data as Record<string, unknown>;
    if (body.kind === "whatsapp") {
      const sub = await subscribeWhatsAppWebhooks({
        employeeId,
        wabaId: String(setup.credentials.waba_id ?? ""),
        accessToken: String(setup.credentials.access_token ?? ""),
        verifyToken: String(setup.credentials.verify_token ?? "")
      });
      const { data: again } = await sb
        .from("ai_employee_integrations")
        .update({ config: { ...config, subscribed: sub.subscribed, ...(sub.error ? { subscribe_error: sub.error } : {}) } })
        .eq("id", existing.id)
        .select(INTEGRATION_COLUMNS)
        .single();
      if (again) row = again as Record<string, unknown>;
    }
    return { integration: redactIntegrationRow(row as { credentials?: Record<string, unknown> }) };
  }

  if (storedConfig.connected_via === "oauth") {
    throw new EmployeeApiError(
      400,
      "invalid_credentials",
      "This integration was connected with one-click sign-in. Disconnect it and connect again to change its account."
    );
  }

  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(body.credentials)) {
    if (value === null) delete merged[key];
    else if (value.trim() !== "") merged[key] = value;
  }
  const clientConfig = { ...withoutServerKeys(storedConfig), ...withoutServerKeys(body.config) };
  const prepared = await prepareIntegrationConnect(
    employeeId,
    {
      kind: body.kind,
      external_id: body.external_id === undefined ? existing.external_id : body.external_id,
      credentials: merged,
      config: clientConfig
    },
    { existingCredentials: stored }
  );
  assertSendableCredentials(body.kind, prepared.credentials);

  const { data, error } = await sb
    .from("ai_employee_integrations")
    .update({
      credentials: encryptIntegrationCredentials(prepared.credentials),
      config: prepared.config,
      external_id: prepared.external_id,
      status: "connected"
    })
    .eq("id", existing.id)
    .eq("employee_id", employeeId)
    .select(INTEGRATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save integration");
  const webhookUrl = body.kind === "meta" || body.kind === "instagram" ? metaWebhookUrl(employeeId) : null;
  return {
    integration: redactIntegrationRow(data as { credentials?: Record<string, unknown> }),
    ...(webhookUrl ? { webhook_url: webhookUrl } : {})
  };
}

export async function disconnectIntegration(employeeId: string, kind: IntegrationKind): Promise<{ ok: true; kind: IntegrationKind }> {
  const existing = await loadRow(employeeId, kind);
  if (!existing) throw notFoundIntegration();
  if (kind === "telegram") {
    const creds = decryptIntegrationCredentials(existing.credentials ?? {});
    if (typeof creds.bot_token === "string") await deleteTelegramWebhook({ bot_token: creds.bot_token });
  }
  const sb = await getServerSupabase();
  const { error } = await sb.from("ai_employee_integrations").delete().eq("id", existing.id).eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  return { ok: true, kind };
}
