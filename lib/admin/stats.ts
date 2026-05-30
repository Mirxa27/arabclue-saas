import { getServiceSupabase } from "@/lib/db/supabase";

export async function getPlatformStats() {
  const supabase = getServiceSupabase();

  const [
    merchants,
    invoices,
    socialPosts,
    socialFailed,
    events,
    escalations,
    billing,
    channels
  ] = await Promise.all([
    supabase.from("merchants").select("id", { count: "exact", head: true }),
    supabase.from("invoices").select("id", { count: "exact", head: true }),
    supabase.from("social_posts").select("id", { count: "exact", head: true }),
    supabase
      .from("social_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase.from("events").select("id", { count: "exact", head: true }),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .in("kind", ["social.escalation", "voice.escalation"]),
    supabase.from("billing_payments").select("id", { count: "exact", head: true }),
    supabase.from("social_channels").select("id", { count: "exact", head: true })
  ]);

  const { data: planRows } = await supabase.from("merchants").select("plan");
  const planCounts: Record<string, number> = {};
  for (const row of planRows ?? []) {
    const p = row.plan ?? "lite";
    planCounts[p] = (planCounts[p] ?? 0) + 1;
  }

  return {
    merchants: merchants.count ?? 0,
    invoices: invoices.count ?? 0,
    socialPosts: socialPosts.count ?? 0,
    socialFailed: socialFailed.count ?? 0,
    events: events.count ?? 0,
    escalations: escalations.count ?? 0,
    billingPayments: billing.count ?? 0,
    socialChannels: channels.count ?? 0,
    planCounts
  };
}

export async function listMerchantsAdmin(limit = 50) {
  const supabase = getServiceSupabase();
  const { data: merchants, error } = await supabase
    .from("merchants")
    .select("id, seller_name, plan, subscription_status, installed_at, access_token, owner_user_id")
    .order("installed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const ids = (merchants ?? []).map((m) => m.id);
  const { data: channelRows } = await supabase
    .from("social_channels")
    .select("merchant_id, platform")
    .in("merchant_id", ids.length ? ids : ["00000000-0000-4000-8000-000000000000"]);

  const channelsByMerchant = new Map<string, string[]>();
  for (const row of channelRows ?? []) {
    const list = channelsByMerchant.get(row.merchant_id) ?? [];
    list.push(row.platform);
    channelsByMerchant.set(row.merchant_id, list);
  }

  return (merchants ?? []).map((m) => ({
    id: m.id,
    sellerName: m.seller_name,
    plan: m.plan,
    subscriptionStatus: m.subscription_status,
    installedAt: m.installed_at,
    sallaConnected: Boolean(m.access_token),
    socialPlatforms: channelsByMerchant.get(m.id) ?? []
  }));
}

export async function listEventsAdmin(limit = 40) {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("events")
    .select("id, kind, merchant, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type EventsAdminFilters = {
  kind?: string;
  merchant?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listEventsAdminFiltered(filters: EventsAdminFilters = {}) {
  const supabase = getServiceSupabase();
  const limit = Math.min(Math.max(filters.limit ?? 40, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  let query = supabase
    .from("events")
    .select("id, kind, merchant, payload, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.kind?.trim()) {
    query = query.eq("kind", filters.kind.trim());
  }
  if (filters.merchant?.trim()) {
    query = query.eq("merchant", filters.merchant.trim());
  }
  if (filters.search?.trim()) {
    query = query.or(`kind.ilike.%${filters.search.trim()}%,payload::text.ilike.%${filters.search.trim()}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    events: data ?? [],
    total: count ?? 0,
    limit,
    offset
  };
}

export async function getMerchantAdminDetail(merchantId: string) {
  const supabase = getServiceSupabase();

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select(
      "id, seller_name, plan, subscription_status, installed_at, access_token, owner_user_id, store_url, vat_number, cr_number, dpa_accepted_at"
    )
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!merchant) return null;

  const [
    invoices,
    socialPosts,
    socialChannels,
    voiceConfig,
    recentEvents,
    billingPayments
  ] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("merchant_id", merchantId),
    supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("merchant_id", merchantId),
    supabase.from("social_channels").select("platform, connected_at").eq("merchant_id", merchantId),
    supabase.from("voice_configs").select("enabled, phone_number").eq("merchant_id", merchantId).maybeSingle(),
    supabase
      .from("events")
      .select("id, kind, payload, created_at")
      .eq("merchant", merchantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("billing_payments").select("id, amount_sar, status, created_at").eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(5)
  ]);

  return {
    id: merchant.id,
    sellerName: merchant.seller_name,
    plan: merchant.plan,
    subscriptionStatus: merchant.subscription_status,
    installedAt: merchant.installed_at,
    storeUrl: merchant.store_url,
    vatNumber: merchant.vat_number,
    crNumber: merchant.cr_number,
    dpaAcceptedAt: merchant.dpa_accepted_at,
    ownerUserId: merchant.owner_user_id,
    sallaConnected: Boolean(merchant.access_token),
    socialPlatforms: (socialChannels.data ?? []).map((c) => c.platform),
    socialChannels: socialChannels.data ?? [],
    voiceEnabled: voiceConfig.data?.enabled ?? false,
    voicePhone: voiceConfig.data?.phone_number ?? null,
    counts: {
      invoices: invoices.count ?? 0,
      socialPosts: socialPosts.count ?? 0
    },
    recentEvents: recentEvents.data ?? [],
    billingPayments: billingPayments.data ?? []
  };
}
