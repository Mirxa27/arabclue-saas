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
      .in("kind", ["social.escalation", "voice.escalation", "employee.escalation"]),
    supabase.from("billing_payments").select("id", { count: "exact", head: true }),
    supabase.from("social_channels").select("id", { count: "exact", head: true })
  ]);

  for (const [name, res] of Object.entries({ merchants, invoices, socialPosts, socialFailed, events, escalations, billing, channels })) {
    if (res.error) throw new Error(`admin stats (${name}): ${res.error.message}`);
  }

  // Exact plan mix grouped in SQL (no PostgREST row cap); only active/past_due
  // subscriptions count as paid, everything else is reported as unpaid.
  const { data: mix, error: mixError } = await supabase.rpc("admin_plan_mix");
  if (mixError) throw new Error(`admin stats (plan mix): ${mixError.message}`);
  const planCounts: Record<string, number> = {};
  let unpaidMerchants = 0;
  for (const row of (mix ?? []) as Array<{ plan: string; subscription_status: string; merchants: number }>) {
    const count = Number(row.merchants);
    if (row.subscription_status === "active" || row.subscription_status === "past_due") {
      planCounts[row.plan] = (planCounts[row.plan] ?? 0) + count;
    } else {
      unpaidMerchants += count;
    }
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
    planCounts,
    unpaidMerchants
  };
}

export type MerchantsAdminQuery = { limit?: number; offset?: number; q?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape LIKE wildcards so the search term is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Paginated, searchable merchant list (#37 — previously a silent 50-row cap). */
export async function listMerchantsAdmin(query: MerchantsAdminQuery = {}) {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50) || 50, 1), 100);
  const offset = Math.max(Math.trunc(query.offset ?? 0) || 0, 0);
  const q = query.q?.trim() ?? "";
  const supabase = getServiceSupabase();

  let builder = supabase
    .from("merchants")
    .select("id, seller_name, plan, subscription_status, installed_at, access_token, owner_user_id", { count: "exact" })
    .order("installed_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (q) builder = UUID_RE.test(q) ? builder.eq("id", q) : builder.ilike("seller_name", `%${escapeLike(q)}%`);

  const { data: merchants, error, count } = await builder;
  if (error) throw new Error(error.message);

  const ids = (merchants ?? []).map((m) => m.id);
  const channelsByMerchant = new Map<string, string[]>();
  if (ids.length) {
    const { data: channelRows, error: channelError } = await supabase
      .from("social_channels")
      .select("merchant_id, platform")
      .in("merchant_id", ids);
    if (channelError) throw new Error(channelError.message);
    for (const row of channelRows ?? []) {
      const list = channelsByMerchant.get(row.merchant_id) ?? [];
      list.push(row.platform);
      channelsByMerchant.set(row.merchant_id, list);
    }
  }

  return {
    merchants: (merchants ?? []).map((m) => ({
      id: m.id,
      sellerName: m.seller_name,
      plan: m.plan,
      subscriptionStatus: m.subscription_status,
      installedAt: m.installed_at,
      sallaConnected: Boolean(m.access_token),
      socialPlatforms: channelsByMerchant.get(m.id) ?? []
    })),
    total: count ?? 0,
    limit,
    offset
  };
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

type AdminEventRow = { id: number; kind: string; merchant: string | null; payload: unknown; created_at: string; total_count: number };

/**
 * Admin event search. Uses the admin_search_events SQL function: PostgREST cannot
 * cast payload::text in a filter, and the function matches the term literally.
 */
export async function listEventsAdminFiltered(filters: EventsAdminFilters = {}) {
  const supabase = getServiceSupabase();
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 40) || 40, 1), 100);
  const offset = Math.max(Math.trunc(filters.offset ?? 0) || 0, 0);

  const { data, error } = await supabase.rpc("admin_search_events", {
    p_search: filters.search?.trim() || null,
    p_kind: filters.kind?.trim() || null,
    p_merchant: filters.merchant?.trim() || null,
    p_limit: limit,
    p_offset: offset
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AdminEventRow[];
  return {
    events: rows.map(({ total_count: _total, ...event }) => event),
    total: rows.length ? Number(rows[0].total_count) : offset,
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
    supabase.from("billing_payments").select("id, amount_halalas, status, created_at").eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(5)
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
