/**
 * Wathq API client — Saudi commercial registry data.
 *
 * Wathq exposes verified CR data, articles of association, national address,
 * GOSI bands, and more. Used by the Pro tier for B2B enrichment.
 *
 * Auth: API key per beneficiary (issued by MoCI after onboarding).
 * Docs: https://developer.wathq.sa/
 *
 * Rate limits: tier-dependent; cache aggressively in Supabase. Every upstream call spends the
 * platform's Wathq allowance, so (SW-26):
 *   - the request has a time cap;
 *   - a not-found CR is cached too (`{ notFound: true }`, NOT_FOUND_TTL_HOURS) so repeating an
 *     unknown number does not go upstream again;
 *   - a response that does not match the documented shape is a 502 (reported), not a 400 that
 *     looks like bad merchant input.
 */
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { getServiceSupabase } from "@/lib/db/supabase";

const BASE = "https://api.wathq.sa";

export const WATHQ_TIMEOUT_MS = 10_000;
const CACHE_TTL_DAYS = 14;
export const NOT_FOUND_TTL_HOURS = 24;

const CRSummarySchema = z.object({
  crNumber: z.string(),
  crEntityName: z.string(),
  crEntityStatus: z.string(),
  crIssueDate: z.string().optional(),
  capital: z.number().optional(),
  city: z.string().optional()
});
export type CRSummary = z.infer<typeof CRSummarySchema>;

const NotFoundMarkerSchema = z.object({ notFound: z.literal(true) });

const upstreamInvalid = () => new HttpError(502, "Wathq returned an unexpected response", "upstream_invalid");

export async function lookupCR(
  crNumber: string,
  apiKey: string,
  opts: { timeoutMs?: number } = {}
): Promise<CRSummary | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/v5/commercialregistration/info/${crNumber}`, {
      headers: { apikey: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? WATHQ_TIMEOUT_MS)
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new HttpError(timedOut ? 504 : 502, timedOut ? "Wathq did not respond in time" : "Wathq could not be reached", "upstream_unavailable");
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new HttpError(503, "Wathq is rate-limiting the platform — try again later", "upstream_rate_limited");
  if (!res.ok) throw upstreamInvalid();
  const data: unknown = await res.json().catch(() => {
    throw upstreamInvalid();
  });
  const parsed = CRSummarySchema.safeParse(data);
  if (!parsed.success) throw upstreamInvalid();
  return parsed.data;
}

// Cached enrichment used by the dashboard.
// wathq_cache is service-role only (RLS on, no Data API grants): served for 14 days as
// "verified" registry data, it must never be writable by clients.

export type EnrichOptions = {
  /** Called right before an upstream request (not for cache hits) — e.g. to spend a daily quota unit. */
  beforeUpstream?: () => Promise<void>;
  timeoutMs?: number;
  now?: () => number;
};

export async function enrichCR(crNumber: string, apiKey: string, opts: EnrichOptions = {}): Promise<CRSummary | null> {
  const now = opts.now ?? Date.now;
  const supabase = getServiceSupabase();
  const cached = await supabase
    .from("wathq_cache")
    .select("payload, fetched_at")
    .eq("cr_number", crNumber)
    .maybeSingle();
  if (cached.data) {
    const ageMs = now() - new Date(cached.data.fetched_at).getTime();
    if (NotFoundMarkerSchema.safeParse(cached.data.payload).success) {
      if (ageMs < NOT_FOUND_TTL_HOURS * 3_600_000) return null;
    } else if (ageMs < CACHE_TTL_DAYS * 86_400_000) {
      const parsed = CRSummarySchema.safeParse(cached.data.payload);
      if (parsed.success) return parsed.data;
    }
  }

  await opts.beforeUpstream?.();
  const fresh = await lookupCR(crNumber, apiKey, { timeoutMs: opts.timeoutMs });
  // Best-effort cache write (hits AND misses): a failure only costs a repeat lookup next time.
  const { error } = await supabase.from("wathq_cache").upsert({
    cr_number: crNumber,
    payload: fresh ?? { notFound: true },
    fetched_at: new Date(now()).toISOString()
  });
  if (error) console.warn("[wathq] cache write failed:", error.code ?? error.message);
  return fresh;
}
