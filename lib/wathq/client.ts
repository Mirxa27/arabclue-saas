/**
 * Wathq API client — Saudi commercial registry data.
 *
 * Wathq exposes verified CR data, articles of association, national address,
 * GOSI bands, and more. Used by the Pro tier for B2B enrichment.
 *
 * Auth: API key per beneficiary (issued by MoCI after onboarding).
 * Docs: https://developer.wathq.sa/
 *
 * Rate limits: tier-dependent; cache aggressively in Supabase.
 */
import { z } from "zod";
import { getServiceSupabase } from "@/lib/db/supabase";

const BASE = "https://api.wathq.sa";

const CRSummarySchema = z.object({
  crNumber: z.string(),
  crEntityName: z.string(),
  crEntityStatus: z.string(),
  crIssueDate: z.string().optional(),
  capital: z.number().optional(),
  city: z.string().optional()
});
export type CRSummary = z.infer<typeof CRSummarySchema>;

export async function lookupCR(crNumber: string, apiKey: string): Promise<CRSummary | null> {
  const res = await fetch(`${BASE}/v5/commercialregistration/info/${crNumber}`, {
    headers: { apikey: apiKey, accept: "application/json" }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wathq CR lookup ${res.status}`);
  const data = await res.json();
  return CRSummarySchema.parse(data);
}

// Cached enrichment used by the dashboard.
// wathq_cache is service-role only (RLS on, no Data API grants): served for 14 days as
// "verified" registry data, it must never be writable by clients.

const CACHE_TTL_DAYS = 14;

export async function enrichCR(crNumber: string, apiKey: string): Promise<CRSummary | null> {
  const supabase = getServiceSupabase();
  const cached = await supabase
    .from("wathq_cache")
    .select("payload, fetched_at")
    .eq("cr_number", crNumber)
    .maybeSingle();
  if (cached.data) {
    const ageDays = (Date.now() - new Date(cached.data.fetched_at).getTime()) / 86_400_000;
    if (ageDays < CACHE_TTL_DAYS) {
      const parsed = CRSummarySchema.safeParse(cached.data.payload);
      if (parsed.success) return parsed.data;
    }
  }
  const fresh = await lookupCR(crNumber, apiKey);
  if (fresh) {
    // Best-effort cache write: a failure only costs a repeat lookup next time.
    const { error } = await supabase.from("wathq_cache").upsert({
      cr_number: crNumber,
      payload: fresh,
      fetched_at: new Date().toISOString()
    });
    if (error) console.warn("[wathq] cache write failed:", error.code ?? error.message);
  }
  return fresh;
}
