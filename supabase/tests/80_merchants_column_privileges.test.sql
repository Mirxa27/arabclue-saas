-- RA-3 / RA-9 (20261106007000_merchants_client_columns.sql): the signed-in owner reads merchants
-- through column grants that leave out every credential. Runs in both DB_TEST_GRANTS modes.
-- Keep `allowed` in sync with lib/merchant/columns.ts (MERCHANT_CLIENT_COLUMNS).
do $$
declare
  c record;
  col text;
  allowed text[] := array[
    'id', 'owner_user_id', 'salla_merchant_id', 'salla_store_name', 'token_expires_at', 'salla_token_invalid_at',
    'installed_at', 'uninstalled_at', 'store_url', 'seller_name', 'vat_number', 'cr_number', 'seller_address',
    'plan', 'subscription_status', 'subscription_expires_at', 'billing_cycle_started_at', 'zatca_onboarded_at',
    'dpa_accepted_at', 'dpa_version'];
  secret text[] := array[
    'access_token', 'refresh_token', 'salla_state', 'salla_refresh_lease', 'salla_refresh_lease_until',
    'zatca_csid', 'zatca_private_key_encrypted'];
begin
  assert not has_table_privilege('authenticated', 'public.merchants', 'SELECT'),
    'merchants SELECT must be column-scoped (a table-level grant covers every column, credentials included)';

  -- every column: readable exactly when allow-listed — new columns stay private until granted
  for c in select attname from pg_attribute where attrelid = 'public.merchants'::regclass and attnum > 0 and not attisdropped loop
    assert has_column_privilege('authenticated', 'public.merchants', c.attname, 'SELECT') = (c.attname = any (allowed)),
      format('merchants.%s: authenticated SELECT must be %s', c.attname, c.attname = any (allowed));
  end loop;

  foreach col in array secret loop
    assert exists (select 1 from pg_attribute where attrelid = 'public.merchants'::regclass and attname = col and not attisdropped),
      format('secret column merchants.%s no longer exists — update this test and lib/merchant/columns.ts', col);
    assert not has_column_privilege('authenticated', 'public.merchants', col, 'SELECT'), format('merchants.%s must not be readable by authenticated', col);
    assert not has_column_privilege('authenticated', 'public.merchants', col, 'UPDATE'), format('merchants.%s must not be writable by authenticated', col);
  end loop;
  foreach col in array allowed loop
    assert exists (select 1 from pg_attribute where attrelid = 'public.merchants'::regclass and attname = col and not attisdropped),
      format('allow-listed column merchants.%s does not exist', col);
  end loop;

  assert not has_any_column_privilege('anon', 'public.merchants', 'SELECT'), 'anon must not read merchants';
  assert has_table_privilege('service_role', 'public.merchants', 'SELECT'), 'service_role reads every column';
end $$;

-- ── as the owner, through the Data API roles ──────────────────────────────────
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000080a1', 'owner-80a@example.test'),
  ('00000000-0000-4000-8000-0000000080b1', 'owner-80b@example.test');
insert into public.merchants (id, owner_user_id, seller_name, salla_merchant_id, access_token, refresh_token, salla_state, zatca_csid, zatca_private_key_encrypted) values
  ('00000000-0000-4000-8000-0000000080a2', '00000000-0000-4000-8000-0000000080a1', 'Store 80A', '80001',
   'enc:v1:SALLA-ACCESS', 'enc:v1:SALLA-REFRESH', 'state-80a', 'ZATCA-CSID-SECRET', 'enc:v1:ZATCA-KEY'),
  ('00000000-0000-4000-8000-0000000080b2', '00000000-0000-4000-8000-0000000080b1', 'Store 80B', '80002',
   'enc:v1:B-ACCESS', null, null, null, null);
insert into public.brand_kits (merchant_id, brand_name) values ('00000000-0000-4000-8000-0000000080a2', 'Brand 80A');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000080a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
declare
  n integer;
  col text;
  r record;
begin
  -- the client column list (lib/merchant/columns.ts), as PostgREST issues it for useMerchant()
  execute $q$
    select id, owner_user_id, salla_merchant_id, salla_store_name, token_expires_at, salla_token_invalid_at, installed_at,
           uninstalled_at, store_url, seller_name, vat_number, cr_number, seller_address, plan, subscription_status,
           subscription_expires_at, billing_cycle_started_at, zatca_onboarded_at, dpa_accepted_at, dpa_version
      from public.merchants where owner_user_id = '00000000-0000-4000-8000-0000000080a1'
  $q$ into r;
  assert r.seller_name = 'Store 80A' and r.salla_merchant_id = '80001', 'owner reads the client columns of their row';
  select count(*) into n from public.merchants;
  assert n = 1, format('RLS still scopes merchants to the owner (saw %s rows)', n);

  -- select * (the old useMerchant / getCurrentMerchant query) is refused
  begin
    perform * from public.merchants;
    raise exception 'select * on merchants must be refused (it includes the tokens)';
  exception when insufficient_privilege then null; end;

  -- every credential column is refused, alone or mixed into an allowed list
  foreach col in array array['access_token', 'refresh_token', 'salla_state', 'salla_refresh_lease',
                             'salla_refresh_lease_until', 'zatca_csid', 'zatca_private_key_encrypted'] loop
    begin
      execute format('select id, %I from public.merchants', col);
      raise exception 'authenticated must not read merchants.%', col;
    exception when insufficient_privilege then null; end;
  end loop;

  -- profile edits (POST /api/merchant/tax, /dpa: PATCH with return=minimal) still work …
  update public.merchants set seller_name = 'Store 80A renamed', dpa_version = '2025-01'
   where id = '00000000-0000-4000-8000-0000000080a2';
  get diagnostics n = row_count;
  assert n = 1, 'owner can still update profile columns';
  -- … RETURNING allow-listed columns works, RETURNING * does not
  execute 'update public.merchants set seller_name = seller_name where id = $1 returning id, seller_name'
    into r using '00000000-0000-4000-8000-0000000080a2'::uuid;
  assert r.seller_name = 'Store 80A renamed', 'returning allowed columns works';
  begin
    execute 'update public.merchants set seller_name = seller_name where id = $1 returning *'
      using '00000000-0000-4000-8000-0000000080a2'::uuid;
    raise exception 'update … returning * must be refused';
  exception when insufficient_privilege then null; end;

  -- RLS policies of other tables (merchant_id in (select id … where owner_user_id = auth.uid()))
  select count(*) into n from public.brand_kits;
  assert n = 1, 'policies referencing merchants.id / owner_user_id still resolve';
end $$;

reset role;

do $$ begin
  assert (select access_token from public.merchants where id = '00000000-0000-4000-8000-0000000080a2') = 'enc:v1:SALLA-ACCESS',
    'service-side reads are unaffected';
end $$;

rollback;
