/**
 * Server-only reads of merchants credentials (RA-3 / RA-9). `authenticated` cannot SELECT these
 * columns (20261106007000_merchants_client_columns.sql), so the session's merchant row never
 * carries them: server code that needs one reads it here, with the service role, by the id of a
 * merchant the caller has already authenticated. Never import this from a client component and
 * never return what it reads to the browser.
 *
 * Salla tokens have their own layer (lib/salla/tokens.ts: decrypt + refresh).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { getServiceSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";

/**
 * @deprecated merchants.zatca_csid is no longer read (F14): ZATCA credentials live per EGS unit in
 * zatca_egs_units (lib/zatca/egs-store.ts). Kept only so nothing breaks while other branches merge.
 */
export async function getMerchantZatcaCsid(merchantId: string, sb: SupabaseClient = getServiceSupabase()): Promise<string | null> {
  const { data, error } = await sb.from("merchants").select("zatca_csid").eq("id", merchantId).maybeSingle();
  if (error) {
    reportError(new Error(`ZATCA credential lookup failed: ${error.message}`), { merchantId });
    throw new HttpError(500, "Could not load the ZATCA credentials. Try again.", "zatca_credentials_unavailable");
  }
  const csid = (data as { zatca_csid?: string | null } | null)?.zatca_csid;
  return typeof csid === "string" && csid.trim() ? csid : null;
}
