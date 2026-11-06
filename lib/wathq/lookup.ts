/**
 * GET /api/wathq/[cr] behind auth (SW-26). Every check that costs nothing runs before
 * anything that spends the platform's Wathq allowance:
 *
 *   CR format (400) → admin "Wathq enrichment" switch (503) → plan (402) → key configured (503)
 *   → per-merchant burst limit (429, in the route) → cache (free) → per-merchant daily cap
 *   (429, service-role counter that holds across instances) → Wathq.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { requirePlatformFeature } from "@/lib/admin/platform-settings";
import { featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import { toAsciiDigits } from "@/lib/i18n/digits";
import { claimUsage, riyadhDate } from "@/lib/usage/counters";
import { enrichCR, type CRSummary } from "@/lib/wathq/client";
import type { Merchant } from "@/lib/types/database";

export const WATHQ_LOOKUPS_PER_MINUTE = 30;
export const WATHQ_UPSTREAM_LOOKUPS_PER_DAY = 500;

/** A Saudi CR number: exactly 10 digits (Arabic-Indic digits accepted). */
export function parseCrNumber(raw: string): string {
  const cr = toAsciiDigits(String(raw ?? "").slice(0, 64)).trim();
  if (!/^\d{10}$/.test(cr)) throw new HttpError(400, "رقم السجل التجاري يجب أن يكون 10 أرقام · CR number must be 10 digits", "invalid_cr");
  return cr;
}

/** Checks that need no Wathq call; returns the API key to use. */
export async function assertWathqAvailable(merchant: Pick<Merchant, "plan" | "subscription_status">): Promise<string> {
  await requirePlatformFeature("wathq");
  if (!merchantCanUseFeature(merchant, "wathq")) throw new HttpError(402, featureGateMessage("wathq"), "plan_required");
  const apiKey = process.env.WATHQ_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, "خدمة واثق غير مهيأة على المنصة · Wathq is not configured on this platform", "wathq_not_configured");
  return apiKey;
}

export async function lookupCrForMerchant(args: {
  merchantId: string;
  cr: string;
  apiKey: string;
  serviceClient: SupabaseClient;
  now?: Date;
}): Promise<CRSummary | null> {
  return enrichCR(args.cr, args.apiKey, {
    beforeUpstream: async () => {
      const claim = await claimUsage(args.serviceClient, {
        merchantId: args.merchantId,
        metric: "wathq.lookup",
        periodStart: riyadhDate(args.now),
        limit: WATHQ_UPSTREAM_LOOKUPS_PER_DAY
      });
      if (!claim.allowed) {
        throw new HttpError(
          429,
          `بلغت الحد اليومي لاستعلامات واثق (${WATHQ_UPSTREAM_LOOKUPS_PER_DAY}) · Daily Wathq lookup limit reached (${WATHQ_UPSTREAM_LOOKUPS_PER_DAY})`,
          "wathq_daily_limit"
        );
      }
    }
  });
}
