import { getServiceSupabase } from "@/lib/db/supabase";
import { decryptIntegrationCredentials } from "@/lib/employees/credentials";
import type { IntegrationErrorInfo } from "@/lib/employees/integration-errors";
import type { AIEmployeeIntegrationRow, IntegrationKind, IntegrationStatus } from "@/lib/employees/types";
import { redactSensitive, reportError } from "@/lib/observability/error-reporter";

export type DecryptedIntegration = AIEmployeeIntegrationRow & { credentials: Record<string, unknown> };

function decrypted(row: AIEmployeeIntegrationRow): DecryptedIntegration {
  return { ...row, config: row.config ?? {}, credentials: decryptIntegrationCredentials(row.credentials) };
}

export async function loadEmployeeIntegration(
  employeeId: string,
  kind: IntegrationKind
): Promise<DecryptedIntegration | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ai_employee_integrations")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("kind", kind)
    .eq("status", "connected")
    .maybeSingle();
  if (!data) return null;
  return decrypted(data as AIEmployeeIntegrationRow);
}

/**
 * Several integrations of one employee in a single round trip (e.g. the Messenger
 * and Instagram rows behind the shared Meta callback). Defaults to connected rows;
 * a DB error throws so webhook routes answer 5xx (the provider retries) instead of 404.
 */
export async function loadEmployeeIntegrations(
  employeeId: string,
  kinds: readonly IntegrationKind[],
  opts: { statuses?: readonly IntegrationStatus[] } = {}
): Promise<DecryptedIntegration[]> {
  const statuses = opts.statuses ?? ["connected"];
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_integrations")
    .select("*")
    .eq("employee_id", employeeId)
    .in("kind", [...kinds])
    .in("status", [...statuses]);
  if (error) throw new Error(`Failed to load integrations: ${error.message}`);
  return ((data ?? []) as AIEmployeeIntegrationRow[]).map(decrypted);
}

/**
 * Flag a connected integration as broken (`status = 'error'`, reason in
 * `config.error`) so the workspace stops showing it as healthy. Only a connected
 * row is flipped; returns whether one was. Never throws.
 */
export async function markIntegrationError(
  employeeId: string,
  kind: IntegrationKind,
  info: IntegrationErrorInfo
): Promise<boolean> {
  try {
    const sb = getServiceSupabase();
    const { data: row, error: readErr } = await sb
      .from("ai_employee_integrations")
      .select("id, config")
      .eq("employee_id", employeeId)
      .eq("kind", kind)
      .eq("status", "connected")
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) return false;
    const current = (row as { id: string; config: Record<string, unknown> | null }).config ?? {};
    const detail = info.detail ? redactSensitive(info.detail).slice(0, 300) : undefined;
    const { error } = await sb
      .from("ai_employee_integrations")
      .update({ status: "error", config: { ...current, error: { ...info, ...(detail ? { detail } : {}) } } })
      .eq("id", (row as { id: string }).id)
      .eq("status", "connected");
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    reportError(err, { extra: { step: "mark_integration_error", employeeId, kind } });
    return false;
  }
}

/** Record that a webhook event arrived for these integration rows. Never throws. */
export async function touchIntegrationLastEvent(integrationIds: readonly string[]): Promise<void> {
  if (integrationIds.length === 0) return;
  try {
    const sb = getServiceSupabase();
    const { error } = await sb
      .from("ai_employee_integrations")
      .update({ last_event_at: new Date().toISOString() })
      .in("id", [...integrationIds]);
    if (error) throw new Error(error.message);
  } catch (err) {
    reportError(err, { extra: { step: "touch_integration_last_event" } });
  }
}
