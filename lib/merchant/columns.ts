/**
 * The merchants columns a signed-in owner may read through the Data API (RA-3 / RA-9).
 *
 * supabase/migrations/20261106007000_merchants_client_columns.sql grants authenticated SELECT on
 * exactly these columns (no table-wide SELECT), so every user-scoped read — the browser hook
 * useMerchant, getCurrentMerchant / getSessionContext and anything rendered from them — must name
 * them: `select("*")` fails with 42501. Kept in sync with the migration by
 * __tests__/merchant/client-columns.test.ts.
 *
 * Client-safe (no server imports). Credentials live only in MERCHANT_SECRET_COLUMNS and are read
 * with the service role in server code (lib/salla/tokens.ts, lib/merchant/secrets.ts).
 */

export const MERCHANT_CLIENT_COLUMNS =
  "id, owner_user_id, salla_merchant_id, salla_store_name, token_expires_at, salla_token_invalid_at, installed_at, uninstalled_at, store_url, seller_name, vat_number, cr_number, seller_address, plan, subscription_status, subscription_expires_at, billing_cycle_started_at, zatca_onboarded_at, dpa_accepted_at, dpa_version" as const;

export const MERCHANT_CLIENT_COLUMN_LIST: readonly string[] = MERCHANT_CLIENT_COLUMNS.split(",").map((c) => c.trim());

/** Never selectable by `authenticated`: Salla OAuth tokens and token-layer state, ZATCA credentials. */
export const MERCHANT_SECRET_COLUMNS = [
  "access_token",
  "refresh_token",
  "salla_state",
  "salla_refresh_lease",
  "salla_refresh_lease_until",
  "zatca_csid",
  "zatca_private_key_encrypted"
] as const;

export type MerchantSecretColumn = (typeof MERCHANT_SECRET_COLUMNS)[number];
