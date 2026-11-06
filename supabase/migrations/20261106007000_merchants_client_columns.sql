-- arabclue · merchants: the signed-in owner reads only non-secret columns (RA-3 / RA-9)
--
-- 20261106001100_api_grants.sql granted authenticated table-wide SELECT on public.merchants. The
-- owner's own session could therefore read — and useMerchant() / getCurrentMerchant() shipped to
-- every dashboard page (browser query + the RSC payload of PageShell) — the Salla OAuth access and
-- refresh tokens, the refresh lease, salla_state and the ZATCA production CSID (the Basic
-- credential for the taxpayer's Fatoora account). Any script on the origin (XSS, extensions) or a
-- saved HAR could take them.
--
-- Column privileges only take effect once the table-level privilege is gone, so: revoke the
-- table-level SELECT (which also revokes any column-level SELECT grants, keeping this re-runnable)
-- and grant SELECT on the allow-listed columns only. Every user-scoped read must name its columns
-- (lib/merchant/columns.ts MERCHANT_CLIENT_COLUMNS): `select=*` now fails with 42501.
-- RLS policies of other tables only use merchants.id and merchants.owner_user_id, which stay
-- readable. UPDATE stays column-scoped as before (20261106001100).
--
-- Service role only (never readable by authenticated): access_token, refresh_token, salla_state,
-- salla_refresh_lease, salla_refresh_lease_until, zatca_csid, zatca_private_key_encrypted — and
-- any column a later migration adds, unless that migration grants it to authenticated explicitly
-- (and lib/merchant/columns.ts lists it).
--
-- Asserted by supabase/tests/80_merchants_column_privileges.test.sql (both grant modes) and kept in
-- sync with lib/merchant/columns.ts by __tests__/merchant/client-columns.test.ts. Re-runnable.

revoke select on table public.merchants from authenticated;
revoke all on table public.merchants from anon;

grant select (
  id,
  owner_user_id,
  salla_merchant_id,
  salla_store_name,
  token_expires_at,
  salla_token_invalid_at,
  installed_at,
  uninstalled_at,
  store_url,
  seller_name,
  vat_number,
  cr_number,
  seller_address,
  plan,
  subscription_status,
  subscription_expires_at,
  billing_cycle_started_at,
  zatca_onboarded_at,
  dpa_accepted_at,
  dpa_version
) on public.merchants to authenticated;

notify pgrst, 'reload schema';
