/**
 * arabclue — Server-side Agent Store operations.
 * Never imported by client components — uses service Supabase client.
 */
import type { PersonaRole } from "./personas";
import type { AgentConfig, AgentStatus } from "./store";
import { getServiceSupabase } from "@/lib/db/supabase";

/** Persist agent enablement after OAuth or install flows. */
export async function updateAgentStatus(
  merchantId: string,
  role: PersonaRole,
  enabled: boolean,
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase.from("ai_employees").upsert(
    {
      merchant_id: merchantId,
      persona_role: role,
      enabled,
      status: enabled ? "active" : "idle",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "merchant_id,persona_role" },
  );

  if (error) {
    throw new Error(error.message);
  }
}