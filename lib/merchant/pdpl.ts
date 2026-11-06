/**
 * PDPL data-subject operations for a merchant account (F26):
 *   - eraseMerchantData: remove everything that would survive the FK cascade
 *   - buildMerchantExport: a complete, machine-readable copy of the merchant's data
 *
 * Both run on the service-role client after the caller has authenticated the
 * merchant. `events` has no FK to merchants and is keyed either by the merchant
 * uuid or (for Salla deliveries) by the Salla merchant id, so both keys are used.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type MerchantKeys = { id: string; salla_merchant_id?: string | null; cr_number?: string | null };

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

export function merchantEventKeys(merchant: MerchantKeys): string[] {
  return [merchant.id, merchant.salla_merchant_id ?? null].filter((k): k is string => Boolean(k && k.trim()));
}

export type ErasureReport = { eventsDeleted: number; wathqCacheDeleted: number };

/** Delete the merchant and everything not covered by `on delete cascade`. */
export async function eraseMerchantData(sb: SupabaseClient, merchant: MerchantKeys): Promise<ErasureReport> {
  const keys = merchantEventKeys(merchant);
  const { count: eventsDeleted, error: eventsErr } = await sb
    .from("events")
    .delete({ count: "exact" })
    .in("merchant", keys);
  if (eventsErr) throw new Error(`erase events: ${eventsErr.message}`);

  let wathqCacheDeleted = 0;
  if (merchant.cr_number?.trim()) {
    const { count, error } = await sb.from("wathq_cache").delete({ count: "exact" }).eq("cr_number", merchant.cr_number.trim());
    if (error) throw new Error(`erase wathq_cache: ${error.message}`);
    wathqCacheDeleted = count ?? 0;
  }

  // Cascades to brand kits, invoices, products, social, voice, bookings, SEO,
  // billing payments and every ai_employee_* table.
  const { error: merchantErr } = await sb.from("merchants").delete().eq("id", merchant.id);
  if (merchantErr) throw new Error(`erase merchant: ${merchantErr.message}`);

  return { eventsDeleted: eventsDeleted ?? 0, wathqCacheDeleted };
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

  const [brandKit, voiceConfig] = await Promise.all([
    sb.from("brand_kits").select("*").eq("merchant_id", id).maybeSingle(),
    sb.from("voice_configs").select("*").eq("merchant_id", id).maybeSingle()
  ]);
  if (brandKit.error) throw new Error(brandKit.error.message);
  if (voiceConfig.error) throw new Error(voiceConfig.error.message);

  const [invoices, products, socialPlans, socialPosts, socialChannels, seoContent, bookings, billingPayments, employees] =
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
      all<{ id: string }>("ai_employees", (f, t) => sb.from("ai_employees").select("*").eq("merchant_id", id).range(f, t))
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

  const keys = merchantEventKeys(merchant);
  const events = await all("events", (f, t) =>
    sb.from("events").select("id, kind, payload, created_at").in("merchant", keys).order("created_at").range(f, t)
  );

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
    events,
    truncated
  };
}
