import { getServiceSupabase } from "@/lib/db/supabase";
import { decryptIntegrationCredentials } from "@/lib/employees/credentials";
import type { AIEmployeeIntegrationRow, IntegrationKind } from "@/lib/employees/types";

export async function loadEmployeeIntegration(
  employeeId: string,
  kind: IntegrationKind
): Promise<(AIEmployeeIntegrationRow & { credentials: Record<string, unknown> }) | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ai_employee_integrations")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("kind", kind)
    .eq("status", "connected")
    .maybeSingle();
  if (!data) return null;
  const row = data as AIEmployeeIntegrationRow;
  return {
    ...row,
    credentials: decryptIntegrationCredentials(row.credentials)
  };
}
