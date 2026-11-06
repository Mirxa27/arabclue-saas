/**
 * The three switches every social path honours (SW-11, SW-13):
 *
 *   platform  admin kill switches in platform_settings — agents.social.enabled (publishing,
 *             planning, the inbound engager) and features.socialOAuth (connecting accounts)
 *   plan      merchantCanUseFeature(merchant, 'social'): a plan that includes the module and an
 *             active (or past_due grace) subscription — lib/billing/entitlements.ts is the single
 *             source of truth; the claim SQL receives the plan/status lists derived from it here
 *   merchant  the merchant's own social agent switch (agent_settings, persona 'social'):
 *             enabled and not 'paused'. No row = never switched on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentSettings, getFeatureSettings } from "@/lib/admin/platform-settings";
import { merchantCanUseFeature, planIncludesFeature } from "@/lib/billing/entitlements";
import { getServiceSupabase } from "@/lib/db/supabase";
import type { Merchant, MerchantPlan } from "@/lib/types/database";

type Entitlement = Pick<Merchant, "plan" | "subscription_status">;

const ALL_PLANS: readonly MerchantPlan[] = ["lite", "plus", "pro", "enterprise"];
const ALL_SUBSCRIPTION_STATUSES = ["pending", "active", "past_due", "canceled"] as const;

/** Plans whose features include social (for the claim/hold SQL). */
export function socialEntitledPlans(): MerchantPlan[] {
  return ALL_PLANS.filter((plan) => planIncludesFeature(plan, "social"));
}

/** Subscription statuses merchantCanUseFeature accepts (derived, not restated). */
export function socialEntitledStatuses(): string[] {
  const entitledPlan = socialEntitledPlans()[0];
  if (!entitledPlan) return [];
  return ALL_SUBSCRIPTION_STATUSES.filter((status) =>
    merchantCanUseFeature({ plan: entitledPlan, subscription_status: status }, "social")
  );
}

export function isSocialEntitled(merchant: Entitlement | null | undefined): boolean {
  return Boolean(merchant && merchantCanUseFeature(merchant, "social"));
}

async function loadEntitlement(sb: SupabaseClient, merchantId: string): Promise<Entitlement | null> {
  const { data, error } = await sb
    .from("merchants")
    .select("plan, subscription_status")
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw new Error(`merchant plan lookup failed: ${error.message}`);
  return (data as Entitlement | null) ?? null;
}

// ─── connecting accounts ─────────────────────────────────────────────────────

export type SocialConnectBlock = "social_disabled" | "plan_required";

/** Why this merchant may not connect a social account right now (null = allowed). */
export async function socialConnectBlock(merchant: Entitlement): Promise<SocialConnectBlock | null> {
  const features = await getFeatureSettings();
  if (features.socialOAuth === false) return "social_disabled";
  if (!merchantCanUseFeature(merchant, "social")) return "plan_required";
  return null;
}

export async function socialConnectBlockById(
  merchantId: string,
  sb: SupabaseClient = getServiceSupabase()
): Promise<SocialConnectBlock | null> {
  const entitlement = await loadEntitlement(sb, merchantId);
  return socialConnectBlock(entitlement ?? { plan: "lite", subscription_status: "pending" });
}

// ─── the merchant's social agent switch ─────────────────────────────────────

export type SocialAgentState = { enabled: boolean; status: string } | null;

export async function loadSocialAgentState(sb: SupabaseClient, merchantId: string): Promise<SocialAgentState> {
  const { data, error } = await sb
    .from("agent_settings")
    .select("enabled, status")
    .eq("merchant_id", merchantId)
    .eq("persona_role", "social")
    .maybeSingle();
  if (error) throw new Error(`agent_settings lookup failed: ${error.message}`);
  return (data as SocialAgentState) ?? null;
}

export function socialAgentActive(state: SocialAgentState): boolean {
  return Boolean(state?.enabled && state.status !== "paused");
}

export type FirstConnectResult = "created" | "kept" | "not_entitled";

/**
 * Switch the social agent on when a merchant connects their first account — insert-only, so a
 * merchant who paused the agent is never switched back on by a reconnect (SW-11), and gated on
 * the plan exactly like PATCH /api/agents/status.
 */
export async function enableSocialAgentOnFirstConnect(
  merchantId: string,
  sb: SupabaseClient = getServiceSupabase()
): Promise<FirstConnectResult> {
  const entitlement = await loadEntitlement(sb, merchantId);
  if (!isSocialEntitled(entitlement)) return "not_entitled";
  const { data, error } = await sb
    .from("agent_settings")
    .upsert(
      { merchant_id: merchantId, persona_role: "social", enabled: true, status: "active", last_error: null },
      { onConflict: "merchant_id,persona_role", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(`agent_settings insert failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0 ? "created" : "kept";
}

// ─── inbound engager ────────────────────────────────────────────────────────

export type InboundGate =
  | { allowed: true }
  | { allowed: false; reason: "platform_disabled" | "plan_required" | "agent_paused" };

/** Whether an inbound comment/DM may reach the engager (an LLM call on the platform's key). */
export async function socialInboundGate(sb: SupabaseClient, merchantId: string): Promise<InboundGate> {
  const agents = await getAgentSettings();
  if (!agents.social.enabled) return { allowed: false, reason: "platform_disabled" };
  const [entitlement, agent] = await Promise.all([loadEntitlement(sb, merchantId), loadSocialAgentState(sb, merchantId)]);
  if (!isSocialEntitled(entitlement)) return { allowed: false, reason: "plan_required" };
  if (!socialAgentActive(agent)) return { allowed: false, reason: "agent_paused" };
  return { allowed: true };
}
