import type { SupabaseClient } from "@supabase/supabase-js";
import { engager } from "@/lib/social/agent";
import { reportError } from "@/lib/observability/error-reporter";
import { socialInboundGate, type InboundGate } from "@/lib/social/gates";
import type { BrandVoice, Platform, ReplyDecision } from "@/lib/social/types";

export type InboundSocialMessage = {
  merchantId: string;
  platform: Platform;
  kind: "dm" | "comment" | "mention";
  from: string;
  text: string;
};

export type InboundSkipReason = Extract<InboundGate, { allowed: false }>["reason"];

export type HandoverResult = {
  decision: ReplyDecision;
  eventId?: string;
  /** Set when the engager was not run (admin kill switch, plan, or the merchant paused the agent). */
  skipped?: InboundSkipReason;
};

async function loadBrandVoice(supabase: SupabaseClient, merchantId: string): Promise<BrandVoice> {
  const { data } = await supabase.from("brand_kits").select("*").eq("merchant_id", merchantId).maybeSingle();
  if (data) {
    return {
      name: data.brand_name ?? "Brand",
      essence: data.essence ?? "",
      attributes: (data.attributes as string[]) ?? [],
      favorWords: (data.favor_words as string[]) ?? undefined,
      avoidWords: (data.avoid_words as string[]) ?? undefined,
      dialect: (data.dialect as BrandVoice["dialect"]) ?? "khaliji"
    };
  }
  const { data: merchant } = await supabase.from("merchants").select("seller_name").eq("id", merchantId).maybeSingle();
  return {
    name: merchant?.seller_name ?? "المتجر",
    essence: "Arabic-first GCC retail",
    attributes: ["helpful", "respectful", "clear"],
    dialect: "khaliji"
  };
}

/**
 * Run the engager agent and persist escalation events for human handover (voice ops desk).
 *
 * SW-11 / SW-13: the engager is an LLM call on the platform's key, so it runs only while the
 * admin's social agent switch is on, the merchant's plan includes social and the merchant's own
 * social agent is switched on. Otherwise the message is acknowledged without an LLM call and a
 * `social.inbound.skipped` event (no message text) records why.
 */
export async function processSocialInbound(
  supabase: SupabaseClient,
  msg: InboundSocialMessage
): Promise<HandoverResult> {
  const gate = await socialInboundGate(supabase, msg.merchantId);
  if (!gate.allowed) {
    const { error } = await supabase.from("events").insert({
      kind: "social.inbound.skipped",
      merchant: msg.merchantId,
      payload: { platform: msg.platform, kind: msg.kind, reason: gate.reason, at: new Date().toISOString() }
    });
    if (error) reportError(new Error(`social.inbound.skipped event failed: ${error.message}`), { merchantId: msg.merchantId });
    return { decision: { action: "ignore", reason: `engager not run: ${gate.reason}` }, skipped: gate.reason };
  }

  const brand = await loadBrandVoice(supabase, msg.merchantId);
  const decision = await engager({
    brand,
    platform: msg.platform,
    context: { kind: msg.kind, from: msg.from, text: msg.text }
  });

  await supabase.from("events").insert({
    kind: "social.inbound",
    merchant: msg.merchantId,
    payload: {
      platform: msg.platform,
      kind: msg.kind,
      from: msg.from,
      text: msg.text,
      decision,
      at: new Date().toISOString()
    }
  });

  let eventId: string | undefined;
  if (decision.action === "escalate") {
    const { data: vc } = await supabase
      .from("voice_configs")
      .select("escalation_phone")
      .eq("merchant_id", msg.merchantId)
      .maybeSingle();

    const { data: ev } = await supabase
      .from("events")
      .insert({
        kind: "social.escalation",
        merchant: msg.merchantId,
        payload: {
          platform: msg.platform,
          from: msg.from,
          reason: decision.reason,
          summary: msg.text,
          escalationPhone: vc?.escalation_phone ?? null,
          at: new Date().toISOString()
        }
      })
      .select("id")
      .single();
    eventId = ev?.id;
  }

  return { decision, eventId };
}
