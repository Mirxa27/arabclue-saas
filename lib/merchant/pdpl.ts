/**
 * PDPL data-subject operations for a merchant account (F26):
 *   - eraseMerchantData: remove everything that would survive the FK cascade
 *   - buildMerchantExport: a complete, machine-readable copy of the merchant's data
 *
 * Both run on the service-role client after the caller has authenticated the
 * merchant. `events` has no FK to merchants and is keyed either by the merchant
 * uuid or (for Salla deliveries) by the Salla store id. Disconnect clears
 * merchants.salla_merchant_id, so the store ids come from the link history
 * (salla_store_links, 20261106007100) — every store the merchant has linked, each
 * with the time window of its events that belong to this merchant (RB-S1).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type MerchantKeys = {
  id: string;
  owner_user_id?: string | null;
  salla_merchant_id?: string | null;
  cr_number?: string | null;
};

/**
 * A Salla store this merchant has linked and the window of the store's events that belong to it:
 * [from, to), null = unbounded. A store's events belong to whoever linked it last before them
 * (events before the first link: the first linker), so a store later linked by another merchant
 * never exports or erases that merchant's events.
 */
export type SallaStoreWindow = { storeId: string; from: string | null; to: string | null };

const StoreWindowRowsSchema = z.array(
  z.object({ salla_merchant_id: z.string(), from_at: z.string().nullable(), to_at: z.string().nullable() })
);

const PAGE_SIZE = 1000;
/** Per-table export cap; reported as truncated if reached. */
export const EXPORT_ROW_CAP = 50_000;
const ID_CHUNK = 100;

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Page through a PostgREST query (max-rows defaults to 1000 per request). */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => QueryResult<T>,
  cap: number = EXPORT_ROW_CAP
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, cap) - 1;
    const { data, error } = await query(from, to);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Every Salla store the merchant has linked (salla_merchant_event_windows), with its event window.
 * The current store is always covered, even if its link predates the history.
 */
export async function loadSallaStoreWindows(sb: SupabaseClient, merchant: MerchantKeys): Promise<SallaStoreWindow[]> {
  const { data, error } = await sb.rpc("salla_merchant_event_windows", { p_merchant_id: merchant.id });
  if (error) throw new Error(`salla store history: ${error.message}`);
  const windows: SallaStoreWindow[] = StoreWindowRowsSchema.parse(data ?? []).map((row) => ({
    storeId: row.salla_merchant_id,
    from: row.from_at,
    to: row.to_at
  }));
  const current = merchant.salla_merchant_id?.trim();
  if (current && !windows.some((w) => w.storeId === current)) windows.push({ storeId: current, from: null, to: null });
  return windows;
}

/** Every key the events log may use for this merchant: its uuid, its current and its former Salla store ids. */
export function merchantEventKeys(merchant: MerchantKeys, storeWindows: readonly SallaStoreWindow[] = []): string[] {
  const keys: string[] = [];
  for (const key of [merchant.id, merchant.salla_merchant_id ?? null, ...storeWindows.map((w) => w.storeId)]) {
    const value = key?.trim();
    if (value && !keys.includes(value)) keys.push(value);
  }
  return keys;
}

/** One events query scope: a key, optionally bounded in time (Salla store windows). */
type EventScope = { key: string; from: string | null; to: string | null };

function eventScopes(merchant: MerchantKeys, windows: readonly SallaStoreWindow[]): EventScope[] {
  return [{ key: merchant.id, from: null, to: null }, ...windows.map((w) => ({ key: w.storeId, from: w.from, to: w.to }))];
}

type EventsFilter = { eq(c: string, v: string): EventsFilter; gte(c: string, v: string): EventsFilter; lt(c: string, v: string): EventsFilter };

function scoped<Q>(query: Q, scope: EventScope): Q {
  let q = (query as unknown as EventsFilter).eq("merchant", scope.key);
  if (scope.from) q = q.gte("created_at", scope.from);
  if (scope.to) q = q.lt("created_at", scope.to);
  return q as unknown as Q;
}

export type ErasureReport = { eventsDeleted: number; wathqCacheDeleted: number };

/** Delete the merchant and everything not covered by `on delete cascade`. */
export async function eraseMerchantData(
  sb: SupabaseClient,
  merchant: MerchantKeys,
  opts: { ownerEmail?: string | null } = {}
): Promise<ErasureReport> {
  // Parked Salla installs authorized by this user (Easy Mode, never claimed) carry their email.
  const ownerEmail = opts.ownerEmail?.trim().toLowerCase();
  if (ownerEmail) {
    const { error: installsErr } = await sb.from("salla_installs").delete().eq("owner_email", ownerEmail);
    if (installsErr) throw new Error(`erase salla_installs: ${installsErr.message}`);
  }

  // Read the store history first: a failure must not leave a half-erased account.
  const windows = await loadSallaStoreWindows(sb, merchant);
  let eventsDeleted = 0;
  for (const scope of eventScopes(merchant, windows)) {
    const { count, error: eventsErr } = await scoped(sb.from("events").delete({ count: "exact" }), scope);
    if (eventsErr) throw new Error(`erase events: ${eventsErr.message}`);
    eventsDeleted += count ?? 0;
  }

  let wathqCacheDeleted = 0;
  if (merchant.cr_number?.trim()) {
    const { count, error } = await sb.from("wathq_cache").delete({ count: "exact" }).eq("cr_number", merchant.cr_number.trim());
    if (error) throw new Error(`erase wathq_cache: ${error.message}`);
    wathqCacheDeleted = count ?? 0;
  }

  // Cascades to brand kits, invoices, products, social, voice, bookings, SEO,
  // billing payments, agent settings and every ai_employee_* table. The store link
  // history keeps its periods without the merchant id (other merchants' windows).
  // Support tickets / feedback go with the auth user (delete-account deletes it).
  const { error: merchantErr } = await sb.from("merchants").delete().eq("id", merchant.id);
  if (merchantErr) throw new Error(`erase merchant: ${merchantErr.message}`);

  return { eventsDeleted, wathqCacheDeleted };
}

export type MerchantExport = Record<string, unknown> & { truncated: string[] };

export async function buildMerchantExport(sb: SupabaseClient, merchant: MerchantKeys & Record<string, unknown>): Promise<MerchantExport> {
  const truncated: string[] = [];
  const all = async <T>(name: string, query: (from: number, to: number) => QueryResult<T>): Promise<T[]> => {
    const { rows, truncated: cut } = await fetchAllRows(query);
    if (cut) truncated.push(name);
    return rows;
  };
  const id = merchant.id;
  const ownerId = typeof merchant.owner_user_id === "string" && merchant.owner_user_id ? merchant.owner_user_id : null;
  // Tickets and feedback belong to the owner's auth user (their RLS: user_id = auth.uid()), which
  // also covers rows filed before onboarding (merchant_id null). Without an owner: the merchant id.
  const byOwner = (table: string) =>
    ownerId ? sb.from(table).select("*").eq("user_id", ownerId) : sb.from(table).select("*").eq("merchant_id", id);

  const windows = await loadSallaStoreWindows(sb, merchant);

  const [brandKit, voiceConfig] = await Promise.all([
    sb.from("brand_kits").select("*").eq("merchant_id", id).maybeSingle(),
    sb.from("voice_configs").select("*").eq("merchant_id", id).maybeSingle()
  ]);
  if (brandKit.error) throw new Error(brandKit.error.message);
  if (voiceConfig.error) throw new Error(voiceConfig.error.message);

  const [
    invoices,
    products,
    socialPlans,
    socialPosts,
    socialChannels,
    seoContent,
    bookings,
    billingPayments,
    employees,
    agentSettings,
    supportTickets,
    userFeedback,
    sallaStoreLinks
  ] =
    await Promise.all([
      all("invoices", (f, t) => sb.from("invoices").select("*").eq("merchant_id", id).order("created_at").range(f, t)),
      all("salla_products", (f, t) => sb.from("salla_products").select("*").eq("merchant_id", id).range(f, t)),
      all("social_plans", (f, t) => sb.from("social_plans").select("*").eq("merchant_id", id).range(f, t)),
      all("social_posts", (f, t) => sb.from("social_posts").select("*").eq("merchant_id", id).range(f, t)),
      all("social_channels", (f, t) =>
        sb.from("social_channels").select("platform, external_id, connected_at").eq("merchant_id", id).range(f, t)
      ),
      all("seo_content", (f, t) => sb.from("seo_content").select("*").eq("merchant_id", id).range(f, t)),
      all("bookings", (f, t) => sb.from("bookings").select("*").eq("merchant_id", id).order("created_at").range(f, t)),
      all("billing_payments", (f, t) =>
        sb.from("billing_payments").select("*").eq("merchant_id", id).order("created_at").range(f, t)
      ),
      all<{ id: string }>("ai_employees", (f, t) => sb.from("ai_employees").select("*").eq("merchant_id", id).range(f, t)),
      all("agent_settings", (f, t) => sb.from("agent_settings").select("*").eq("merchant_id", id).order("created_at").range(f, t)),
      all("support_tickets", (f, t) => byOwner("support_tickets").order("created_at").range(f, t)),
      all("user_feedback", (f, t) => byOwner("user_feedback").order("created_at").range(f, t)),
      all("salla_store_links", (f, t) =>
        sb.from("salla_store_links").select("salla_merchant_id, linked_at, unlinked_at").eq("merchant_id", id).order("linked_at").range(f, t)
      )
    ]);

  const employeeIds = employees.map((e) => e.id);
  const byEmployee = async <T>(name: string, table: string, columns: string): Promise<T[]> => {
    const out: T[] = [];
    for (const ids of chunks(employeeIds, ID_CHUNK)) {
      out.push(...(await all<T>(name, (f, t) => sb.from(table).select(columns).in("employee_id", ids).range(f, t) as unknown as QueryResult<T>)));
    }
    return out;
  };

  const [integrations, conversations, tasks, actions] = await Promise.all([
    // Never export credentials (encrypted provider tokens/secrets).
    byEmployee("ai_employee_integrations", "ai_employee_integrations", "employee_id, kind, external_id, config, status, last_event_at, created_at"),
    byEmployee<{ id: string }>("ai_employee_conversations", "ai_employee_conversations", "*"),
    byEmployee("ai_employee_tasks", "ai_employee_tasks", "*"),
    byEmployee("ai_employee_actions", "ai_employee_actions", "*")
  ]);

  const messages: unknown[] = [];
  for (const ids of chunks(conversations.map((c) => c.id), ID_CHUNK)) {
    messages.push(
      ...(await all("ai_employee_messages", (f, t) =>
        sb.from("ai_employee_messages").select("*").in("conversation_id", ids).order("created_at").range(f, t)
      ))
    );
  }

  type EventRow = { id: number | string; created_at: string | null };
  const events: EventRow[] = [];
  for (const scope of eventScopes(merchant, windows)) {
    events.push(
      ...(await all<EventRow>("events", (f, t) =>
        scoped(sb.from("events").select("id, kind, payload, created_at"), scope).order("created_at").range(f, t) as unknown as QueryResult<EventRow>
      ))
    );
  }
  events.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || Number(a.id) - Number(b.id));

  return {
    exportedAt: new Date().toISOString(),
    merchant: {
      id: merchant.id,
      seller_name: merchant.seller_name,
      vat_number: merchant.vat_number,
      cr_number: merchant.cr_number,
      seller_address: merchant.seller_address,
      plan: merchant.plan,
      subscription_status: merchant.subscription_status,
      store_url: merchant.store_url,
      installed_at: merchant.installed_at,
      dpa_accepted_at: merchant.dpa_accepted_at,
      dpa_version: merchant.dpa_version
    },
    brandKit: brandKit.data,
    voiceConfig: voiceConfig.data,
    invoices,
    products,
    socialPlans,
    socialPosts,
    socialChannels,
    seoContent,
    bookings,
    billingPayments,
    aiEmployees: employees,
    aiEmployeeIntegrations: integrations,
    aiEmployeeConversations: conversations,
    aiEmployeeMessages: messages,
    aiEmployeeTasks: tasks,
    aiEmployeeActions: actions,
    agentSettings,
    supportTickets,
    userFeedback,
    sallaStoreLinks,
    events,
    truncated: [...new Set(truncated)]
  };
}
