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

// Cached enrichment used by the dashboard
import { getServerSupabase } from "@/lib/db/supabase";

const CACHE_TTL_DAYS = 14;

export async function enrichCR(crNumber: string, apiKey: string): Promise<CRSummary | null> {
  const supabase = getServerSupabase();
  const cached = await supabase.from("wathq_cache").select("*").eq("cr_number", crNumber).single();
  if (cached.data) {
    const ageDays = (Date.now() - new Date(cached.data.fetched_at).getTime()) / 86_400_000;
    if (ageDays < CACHE_TTL_DAYS) return cached.data.payload as CRSummary;
  }
  const fresh = await lookupCR(crNumber, apiKey);
  if (fresh) {
    await supabase.from("wathq_cache").upsert({
      cr_number: crNumber,
      payload: fresh,
      fetched_at: new Date().toISOString()
    });
  }
  return fresh;
}
