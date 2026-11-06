/**
 * arabclue — Server-side persona agent store (public.agent_settings).
 * Never imported by client components — writes use the service Supabase client.
 *
 * agent_settings is read-only for merchants through the Data API; every write goes
 * through here after the caller's session check, so switching an agent on can be tied
 * to the merchant's plan.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/db/supabase";
import { assertNoDbError } from "@/lib/db/errors";
import { HttpError } from "@/lib/api/errors";
import { featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import type { Merchant } from "@/lib/types/database";
import {
  AGENT_SETTING_COLUMNS,
  buildAgentEntries,
  buildAgentEntry,
  featureForAgentRole,
  nextAgentSetting,
  patchActivatesAgent,
  type AgentEntry,
  type AgentPatch,
  type AgentRole,
  type AgentSettingRow
} from "./settings";

/** All persona agents for a merchant, defaults filled in. `sb` may be the user's own client (RLS). */
export async function listAgentEntries(sb: SupabaseClient, merchantId: string): Promise<AgentEntry[]> {
  const { data, error } = await sb
    .from("agent_settings")
    .select(AGENT_SETTING_COLUMNS)
    .eq("merchant_id", merchantId);
  assertNoDbError(error, "Load agent settings", { merchantId, route: "agents/status" });
  return buildAgentEntries((data ?? []) as AgentSettingRow[]);
}

/** Apply a dashboard toggle/configuration change. Enabling requires the plan feature. */
export async function applyAgentPatch(merchant: Merchant, patch: AgentPatch): Promise<AgentEntry> {
  if (patchActivatesAgent(patch)) {
    const feature = featureForAgentRole(patch.role);
    if (!merchantCanUseFeature(merchant, feature)) {
      throw new HttpError(402, featureGateMessage(feature), "plan_required");
    }
  }

  const sb = getServiceSupabase();
  const { data: existing, error: readErr } = await sb
    .from("agent_settings")
    .select(AGENT_SETTING_COLUMNS)
    .eq("merchant_id", merchant.id)
    .eq("persona_role", patch.role)
    .maybeSingle();
  assertNoDbError(readErr, "Load agent settings", { merchantId: merchant.id, route: "agents/status" });

  const next = nextAgentSetting(existing as AgentSettingRow | null, patch);
  const { data, error } = await sb
    .from("agent_settings")
    .upsert(
      { merchant_id: merchant.id, persona_role: patch.role, ...next },
      { onConflict: "merchant_id,persona_role" }
    )
    .select(AGENT_SETTING_COLUMNS)
    .single();
  assertNoDbError(error, "Save agent settings", { merchantId: merchant.id, route: "agents/status" });
  return buildAgentEntry(patch.role, data as AgentSettingRow);
}

/**
 * Switch a persona agent on or off after an OAuth or install flow (every social OAuth callback,
 * the manual channel connect route, the Salla connect callback).
 *
 * Switching ON is tied to the merchant's plan exactly like PATCH /api/agents/status: when the plan
 * or subscription does not include the agent's module nothing is written (an existing row keeps
 * its state) and the result is false. Switching off always applies. Returns whether the agent is
 * enabled now.
 */
export async function updateAgentStatus(merchantId: string, role: AgentRole, enabled: boolean): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (enabled) {
    const { data, error: planErr } = await supabase
      .from("merchants")
      .select("plan, subscription_status")
      .eq("id", merchantId)
      .maybeSingle();
    if (planErr) throw new Error(`Load merchant plan failed: ${planErr.message}`);
    const entitlement = data as Pick<Merchant, "plan" | "subscription_status"> | null;
    if (!entitlement || !merchantCanUseFeature(entitlement, featureForAgentRole(role))) return false;
  }

  const { error } = await supabase.from("agent_settings").upsert(
    {
      merchant_id: merchantId,
      persona_role: role,
      enabled,
      status: enabled ? "active" : "idle",
      last_error: null
    },
    { onConflict: "merchant_id,persona_role" }
  );

  if (error) {
    throw new Error(error.message);
  }
  return enabled;
}
