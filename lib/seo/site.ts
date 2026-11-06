/**
 * The SEO page's site audit (F21 / UI-004): the merchant's store URL, the latest stored
 * audit, and running a new one.
 *
 *  - store_url is a merchant profile column the owner may UPDATE through the Data API, so it
 *    is saved with the user's RLS-scoped session after validation (lib/seo/store-url.ts + the
 *    outbound guard's host checks).
 *  - Audit results are written by the server only (service role): seo_site_audits is
 *    SELECT-only for the owner, so what the page shows is what the server measured.
 *  - Each audit spends a unit of a per-merchant daily counter (on top of the route's rate
 *    limit) because it makes outbound requests on the merchant's behalf.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import { reportError } from "@/lib/observability/error-reporter";
import { OutboundUrlError, parsePublicHttpUrl } from "@/lib/security/outbound-http";
import { pickProductUrls, runSiteAudit, type AuditDeps } from "@/lib/seo/audit";
import type { SiteAuditResult } from "@/lib/seo/audit-types";
import { normalizeStoreUrl } from "@/lib/seo/store-url";
import { claimUsage, releaseUsage, riyadhDate } from "@/lib/usage/counters";
import type { Merchant } from "@/lib/types/database";

export const SEO_AUDITS_PER_DAY = 30;
/** Stored audits kept per merchant (older rows are pruned after each run). */
export const SEO_AUDITS_KEPT = 20;

export type StoredSiteAudit = SiteAuditResult & { id: string; saved: boolean };

export type SeoSiteState = { store_url: string | null; audit: StoredSiteAudit | null };

const AUDIT_COLUMNS = "id, url, pages, issues, summary, created_at";

type AuditRow = {
  id: string;
  url: string;
  pages: SiteAuditResult["pages"] | null;
  issues: SiteAuditResult["issues"] | null;
  summary: SiteAuditResult["summary"] | null;
  created_at: string;
};

function fromRow(row: AuditRow): StoredSiteAudit {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const pages = Array.isArray(row.pages) ? row.pages : [];
  return {
    id: row.id,
    url: row.url,
    audited_at: row.created_at,
    pages,
    issues,
    summary: row.summary ?? {
      critical: issues.filter((i) => i.severity === "critical").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
      pages: pages.length
    },
    saved: true
  };
}

/** Validate a typed store URL: format (https, no port/credentials) + public host. */
export function validateStoreUrl(raw: string): string {
  const result = normalizeStoreUrl(raw);
  if (!result.ok) throw new HttpError(400, `${result.message.ar} · ${result.message.en}`, `store_url_${result.code}`);
  try {
    parsePublicHttpUrl(result.url);
  } catch (err) {
    if (err instanceof OutboundUrlError) {
      throw new HttpError(400, "الرابط يجب أن يكون لموقع عام · The store URL must be a public website", "store_url_not_public");
    }
    throw err;
  }
  return result.url;
}

export async function saveStoreUrl(userClient: SupabaseClient, merchantId: string, raw: string): Promise<string> {
  const url = validateStoreUrl(raw);
  const { data, error } = await userClient
    .from("merchants")
    .update({ store_url: url })
    .eq("id", merchantId)
    .select("store_url")
    .maybeSingle();
  assertNoDbError(error, "Save store URL", { route: "PUT /api/seo/site", merchantId });
  if (!data) throw new HttpError(404, "Merchant not found", "merchant_not_found");
  return url;
}

export async function loadSeoSiteState(
  userClient: SupabaseClient,
  merchant: Pick<Merchant, "id" | "store_url">
): Promise<SeoSiteState> {
  const { data, error } = await userClient
    .from("seo_site_audits")
    .select(AUDIT_COLUMNS)
    .eq("merchant_id", merchant.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "Load site audit", { route: "GET /api/seo/audit", merchantId: merchant.id, code: "db_read_failed" });
  return { store_url: merchant.store_url ?? null, audit: data ? fromRow(data as AuditRow) : null };
}

export async function runAndStoreSiteAudit(args: {
  merchant: Pick<Merchant, "id" | "store_url">;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  deps?: AuditDeps;
  now?: Date;
}): Promise<StoredSiteAudit> {
  const { merchant } = args;
  if (!merchant.store_url) {
    throw new HttpError(409, "أضف رابط متجرك أولاً · Add your store URL first", "store_url_required");
  }
  const storeUrl = validateStoreUrl(merchant.store_url);

  const { data: products, error: productsError } = await args.userClient
    .from("salla_products")
    .select("url")
    .eq("merchant_id", merchant.id)
    .not("url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  assertNoDbError(productsError, "Load products", { route: "POST /api/seo/audit", merchantId: merchant.id, code: "db_read_failed" });
  const productUrls = pickProductUrls(storeUrl, ((products ?? []) as Array<{ url: string | null }>).map((p) => p.url));

  const periodStart = riyadhDate(args.now);
  const claim = await claimUsage(args.serviceClient, {
    merchantId: merchant.id,
    metric: "seo.audit",
    periodStart,
    limit: SEO_AUDITS_PER_DAY
  });
  if (!claim.allowed) {
    throw new HttpError(
      429,
      `بلغت حد التدقيق اليومي (${SEO_AUDITS_PER_DAY}) · Daily audit limit reached (${SEO_AUDITS_PER_DAY})`,
      "seo_audit_quota_exceeded"
    );
  }

  let result: SiteAuditResult;
  try {
    result = await runSiteAudit({ storeUrl, productUrls }, args.deps);
  } catch (err) {
    await releaseUsage(args.serviceClient, { merchantId: merchant.id, metric: "seo.audit", periodStart });
    throw err;
  }

  const { data: row, error } = await args.serviceClient
    .from("seo_site_audits")
    .insert({
      merchant_id: merchant.id,
      url: result.url,
      pages: result.pages,
      issues: result.issues,
      summary: result.summary
    })
    .select("id, created_at")
    .single();
  if (error || !row) {
    reportError(new Error(`seo_site_audits insert failed: ${error?.message ?? "no row"}`), {
      route: "POST /api/seo/audit",
      merchantId: merchant.id
    });
    return { ...result, id: "", saved: false };
  }

  const saved = row as { id: string; created_at: string };
  await pruneOldAudits(args.serviceClient, merchant.id);
  return { ...result, id: saved.id, audited_at: saved.created_at ?? result.audited_at, saved: true };
}

/** Keep the newest SEO_AUDITS_KEPT audits of the merchant. Best effort. */
async function pruneOldAudits(sb: SupabaseClient, merchantId: string): Promise<void> {
  try {
    const { data, error } = await sb
      .from("seo_site_audits")
      .select("id")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .range(SEO_AUDITS_KEPT, SEO_AUDITS_KEPT + 99);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return;
    const { error: delError } = await sb.from("seo_site_audits").delete().eq("merchant_id", merchantId).in("id", ids);
    if (delError) throw new Error(delError.message);
  } catch (err) {
    reportError(new Error(`seo_site_audits prune failed: ${err instanceof Error ? err.message : String(err)}`), { merchantId });
  }
}
