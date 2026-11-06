-- Salla connect (20261106003000_salla_connect.sql): store linking, Easy Mode installs and
-- their email-verified claim, the refresh lease, and the privileges around all of it.
-- Fixtures are created by the migration owner and rolled back at the end.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000040a1', 'owner-a@salla-test.example'),
  ('00000000-0000-4000-8000-0000000040b1', 'owner-b@salla-test.example');

insert into public.merchants (id, owner_user_id, seller_name, plan) values
  ('00000000-0000-4000-8000-0000000040a2', '00000000-0000-4000-8000-0000000040a1', null, 'lite'),
  ('00000000-0000-4000-8000-0000000040b2', '00000000-0000-4000-8000-0000000040b1', 'Legal Name B LLC', 'lite');

-- ── privileges ────────────────────────────────────────────────────────────────
do $$
declare
  p text;
  f text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.salla_installs'::regclass), 'RLS must be on for salla_installs';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salla_installs'),
    'salla_installs is service-role only: no policies';
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('anon', 'public.salla_installs', p), format('anon must not have %s on salla_installs', p);
    assert not has_table_privilege('authenticated', 'public.salla_installs', p), format('authenticated must not have %s on salla_installs', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
    assert not has_any_column_privilege('authenticated', 'public.salla_installs', p), format('authenticated must not have column %s on salla_installs', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert has_table_privilege('service_role', 'public.salla_installs', p), format('service_role needs %s on salla_installs', p);
  end loop;

  foreach f in array array[
    'public.salla_link_store(uuid,text,text,text,timestamptz,text)',
    'public.salla_record_authorization(text,text,text,timestamptz,text,text,text,text,text)',
    'public.salla_claim_install(uuid,text,text)',
    'public.salla_claim_refresh_lease(uuid,integer)'] loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon must not execute %s', f);
    assert not has_function_privilege('authenticated', f, 'execute'), format('authenticated must not execute %s', f);
    assert has_function_privilege('service_role', f, 'execute'), format('service_role must execute %s', f);
  end loop;

  -- the token-layer columns are server-side only (merchants UPDATE stays column-scoped)
  foreach p in array array['salla_store_name', 'salla_refresh_lease', 'salla_refresh_lease_until', 'salla_token_invalid_at',
                           'access_token', 'refresh_token', 'token_expires_at'] loop
    assert not has_column_privilege('authenticated', 'public.merchants', p, 'UPDATE'), format('merchants.%s must not be client-writable', p);
  end loop;
end $$;

-- ── salla_link_store ──────────────────────────────────────────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000040a2';
  b constant uuid := '00000000-0000-4000-8000-0000000040b2';
  r jsonb;
begin
  -- a parked Easy Mode row for the store is superseded by the merchant's own link
  insert into public.salla_installs (salla_merchant_id, access_token_encrypted, owner_email, owner_role)
  values ('40001', 'enc:v1:parked', 'owner-a@salla-test.example', 'user');

  r := public.salla_link_store(a, '40001', 'enc:v1:at-a', 'enc:v1:rt-a', now() + interval '14 days', 'Oud House');
  assert r ->> 'outcome' = 'linked', format('first link: %s', r);
  assert (select salla_merchant_id from public.merchants where id = a) = '40001', 'store id stored';
  assert (select access_token from public.merchants where id = a) = 'enc:v1:at-a', 'access token stored as given';
  assert (select refresh_token from public.merchants where id = a) = 'enc:v1:rt-a', 'refresh token stored as given';
  assert (select seller_name from public.merchants where id = a) = 'Oud House', 'empty seller_name filled from the store name';
  assert (select salla_store_name from public.merchants where id = a) = 'Oud House', 'store name stored';
  assert (select uninstalled_at from public.merchants where id = a) is null, 'link clears uninstalled_at';
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '40001'), 'parked row consumed by the link';

  -- another merchant cannot take a linked store
  r := public.salla_link_store(b, '40001', 'enc:v1:at-b', 'enc:v1:rt-b', now() + interval '14 days', 'Oud House');
  assert r ->> 'outcome' = 'store_already_linked', format('second merchant: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:at-a', 'owner tokens untouched';
  assert (select salla_merchant_id from public.merchants where id = b) is null, 'second merchant not linked';

  -- re-linking the same store (reconnect) replaces the tokens and clears the token-layer state
  update public.merchants set salla_token_invalid_at = now(), salla_refresh_lease = gen_random_uuid(),
         salla_refresh_lease_until = now() + interval '1 minute', uninstalled_at = now() where id = a;
  r := public.salla_link_store(a, '40001', 'enc:v1:at-a2', 'enc:v1:rt-a2', now() + interval '14 days', 'Oud House 2');
  assert r ->> 'outcome' = 'linked', format('reconnect: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:at-a2', 'reconnect replaced the token';
  assert (select salla_token_invalid_at is null and salla_refresh_lease is null and uninstalled_at is null
            from public.merchants where id = a), 'reconnect resets invalid marker, lease and uninstalled_at';
  assert (select seller_name from public.merchants where id = a) = 'Oud House', 'a set seller_name is never overwritten';
  assert (select salla_store_name from public.merchants where id = a) = 'Oud House 2', 'store name follows the store';

  -- B's legal seller name survives linking its own store
  r := public.salla_link_store(b, '40002', 'enc:v1:at-b', null, null, 'Shiny Store');
  assert r ->> 'outcome' = 'linked', format('link b: %s', r);
  assert (select seller_name from public.merchants where id = b) = 'Legal Name B LLC', 'legal seller name kept';

  r := public.salla_link_store('00000000-0000-4000-8000-00000000ffff', '40009', 'enc:v1:x', null, null, null);
  assert r ->> 'outcome' = 'merchant_not_found', format('unknown merchant: %s', r);

  begin
    perform public.salla_link_store(a, '  ', 'enc:v1:x', null, null, null);
    raise exception 'blank store id must be rejected';
  exception when sqlstate '22004' then null;
  end;
end $$;

-- ── salla_record_authorization (Easy Mode) ────────────────────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000040a2';
  t0 constant timestamptz := now() + interval '14 days';
  r jsonb;
begin
  -- store 40001 belongs to A: new tokens go straight to the merchant
  r := public.salla_record_authorization('40001', 'enc:v1:easy-at', 'enc:v1:easy-rt', t0 + interval '1 day', 'offline_access');
  assert r ->> 'outcome' = 'linked_updated', format('linked store: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:easy-at', 'linked merchant received the tokens';
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '40001'), 'nothing parked for a linked store';

  -- a late redelivery of an older authorization never replaces newer tokens
  r := public.salla_record_authorization('40001', 'enc:v1:old-at', 'enc:v1:old-rt', t0 - interval '3 days');
  assert r ->> 'outcome' = 'stale', format('older authorization: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:easy-at', 'stale tokens ignored';

  -- after an uninstall (tokens cleared) any authorization reconnects the merchant
  update public.merchants set access_token = null, refresh_token = null, uninstalled_at = now() where id = a;
  r := public.salla_record_authorization('40001', 'enc:v1:re-at', 'enc:v1:re-rt', t0 - interval '5 days');
  assert r ->> 'outcome' = 'linked_updated', format('reinstall: %s', r);
  assert (select access_token = 'enc:v1:re-at' and uninstalled_at is null from public.merchants where id = a), 'reinstall reconnected';

  -- an unknown store is parked, with the installer's identity normalised
  r := public.salla_record_authorization('40100', 'enc:v1:p-at', 'enc:v1:p-rt', t0, 'offline_access',
                                         '  Owner-B@Salla-Test.Example ', 'user', 'Pending Store', 'https://pending.example');
  assert r ->> 'outcome' = 'pending_saved', format('pending: %s', r);
  assert (select owner_email from public.salla_installs where salla_merchant_id = '40100') = 'owner-b@salla-test.example', 'email lower-cased';
  assert (select owner_role from public.salla_installs where salla_merchant_id = '40100') = 'user', 'role stored';

  -- the same authorization redelivered without identity (user/info failed) keeps the identity
  r := public.salla_record_authorization('40100', 'enc:v1:p-at', 'enc:v1:p-rt', t0, 'offline_access');
  assert r ->> 'outcome' = 'pending_saved', format('redelivery: %s', r);
  assert (select owner_email from public.salla_installs where salla_merchant_id = '40100') = 'owner-b@salla-test.example', 'identity kept on redelivery';

  -- an older authorization is ignored; a newer one replaces the tokens and drops the old identity
  r := public.salla_record_authorization('40100', 'enc:v1:older', null, t0 - interval '1 day');
  assert r ->> 'outcome' = 'stale', format('older pending: %s', r);
  assert (select access_token_encrypted from public.salla_installs where salla_merchant_id = '40100') = 'enc:v1:p-at', 'older ignored';
  r := public.salla_record_authorization('40100', 'enc:v1:newer', 'enc:v1:newer-rt', t0 + interval '1 day', null, null, 'team');
  assert r ->> 'outcome' = 'pending_saved', format('newer pending: %s', r);
  assert (select access_token_encrypted = 'enc:v1:newer' and owner_email is null and owner_role = 'team'
            from public.salla_installs where salla_merchant_id = '40100'), 'newer authorization carries its own identity';

  -- unknown role values are not stored; retention drops authorizations older than 60 days
  r := public.salla_record_authorization('40101', 'enc:v1:z', null, null, null, 'z@salla-test.example', 'admin');
  assert (select owner_role from public.salla_installs where salla_merchant_id = '40101') is null, 'unknown role dropped';
  insert into public.salla_installs (salla_merchant_id, access_token_encrypted, authorized_at)
  values ('40199', 'enc:v1:ancient', now() - interval '61 days');
  r := public.salla_record_authorization('40102', 'enc:v1:y', null, null);
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '40199'), 'old unclaimed install pruned';
end $$;

-- ── salla_claim_install ───────────────────────────────────────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000040a2';
  b constant uuid := '00000000-0000-4000-8000-0000000040b2';
  r jsonb;
begin
  insert into public.salla_installs (salla_merchant_id, access_token_encrypted, refresh_token_encrypted, token_expires_at,
                                     owner_email, owner_role, store_name)
  values ('40200', 'enc:v1:claim-at', 'enc:v1:claim-rt', now() + interval '10 days', 'owner-b@salla-test.example', 'user', 'Claimable'),
         ('40201', 'enc:v1:team-at', null, null, 'owner-b@salla-test.example', 'team', 'Team install'),
         ('40202', 'enc:v1:none-at', null, null, null, null, 'No identity');
  insert into public.salla_installs (salla_merchant_id, access_token_encrypted, owner_email, owner_role, authorized_at)
  values ('40203', 'enc:v1:old-at', 'owner-b@salla-test.example', 'user', now() - interval '31 days');

  r := public.salla_claim_install(b, '40200', 'someone-else@salla-test.example');
  assert r ->> 'outcome' = 'not_found', format('wrong email: %s', r);
  r := public.salla_claim_install(b, '40201', 'owner-b@salla-test.example');
  assert r ->> 'outcome' = 'not_found', format('team member install: %s', r);
  r := public.salla_claim_install(b, '40202', 'owner-b@salla-test.example');
  assert r ->> 'outcome' = 'not_found', format('unresolved identity: %s', r);
  r := public.salla_claim_install(b, '40203', 'owner-b@salla-test.example');
  assert r ->> 'outcome' = 'not_found', format('expired authorization: %s', r);
  r := public.salla_claim_install(b, '40200', null);
  assert r ->> 'outcome' = 'not_found', format('no email: %s', r);
  assert (select salla_merchant_id from public.merchants where id = b) = '40002', 'failed claims change nothing';

  r := public.salla_claim_install(b, '40200', ' OWNER-B@salla-test.example ');
  assert r ->> 'outcome' = 'linked', format('claim: %s', r);
  assert (select salla_merchant_id = '40200' and access_token = 'enc:v1:claim-at' and refresh_token = 'enc:v1:claim-rt'
            from public.merchants where id = b), 'claimed tokens moved to the merchant';
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '40200'), 'claimed row removed';

  -- a store already linked elsewhere cannot be claimed into a second merchant
  insert into public.salla_installs (salla_merchant_id, access_token_encrypted, owner_email, owner_role)
  values ('40001', 'enc:v1:dup', 'owner-b@salla-test.example', 'user');
  r := public.salla_claim_install(b, '40001', 'owner-b@salla-test.example');
  assert r ->> 'outcome' = 'store_already_linked', format('linked elsewhere: %s', r);
  assert (select owner_user_id from public.merchants where salla_merchant_id = '40001') = '00000000-0000-4000-8000-0000000040a1',
    'store stays with its owner';
end $$;

-- ── salla_claim_refresh_lease ─────────────────────────────────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000040a2';
  l1 uuid;
  l2 uuid;
begin
  update public.merchants set refresh_token = 'enc:v1:rt', salla_token_invalid_at = null,
         salla_refresh_lease = null, salla_refresh_lease_until = null where id = a;

  l1 := public.salla_claim_refresh_lease(a, 60);
  assert l1 is not null, 'first worker gets the lease';
  assert (select salla_refresh_lease from public.merchants where id = a) = l1, 'lease recorded';
  l2 := public.salla_claim_refresh_lease(a, 60);
  assert l2 is null, 'second worker must wait while the lease is live';

  -- a crashed holder's lease expires
  update public.merchants set salla_refresh_lease_until = now() - interval '1 second' where id = a;
  l2 := public.salla_claim_refresh_lease(a, 60);
  assert l2 is not null and l2 <> l1, 'expired lease is re-claimable with a new id';

  -- lease length is clamped to 5..300 seconds
  update public.merchants set salla_refresh_lease_until = null where id = a;
  l1 := public.salla_claim_refresh_lease(a, 100000);
  assert (select salla_refresh_lease_until <= now() + interval '300 seconds' from public.merchants where id = a), 'lease capped at 300s';

  -- nothing to refresh: no refresh token, or Salla already rejected it
  update public.merchants set salla_refresh_lease_until = null, refresh_token = null where id = a;
  assert public.salla_claim_refresh_lease(a) is null, 'no refresh token → no lease';
  update public.merchants set refresh_token = 'enc:v1:rt', salla_token_invalid_at = now() where id = a;
  assert public.salla_claim_refresh_lease(a) is null, 'invalid refresh token → no lease';
  assert public.salla_claim_refresh_lease('00000000-0000-4000-8000-00000000ffff') is null, 'unknown merchant → no lease';
end $$;

-- ── as a signed-in merchant through the Data API roles ───────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000040a1","role":"authenticated"}', true) as jwt_claims \gset
do $$
begin
  begin
    perform 1 from public.salla_installs limit 1;
    raise exception 'authenticated must not read salla_installs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.salla_claim_install('00000000-0000-4000-8000-0000000040a2', '40100', 'owner-a@salla-test.example');
    raise exception 'authenticated must not call salla_claim_install';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.salla_claim_refresh_lease('00000000-0000-4000-8000-0000000040a2');
    raise exception 'authenticated must not take refresh leases';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.merchants set salla_refresh_lease = null where id = '00000000-0000-4000-8000-0000000040a2';
    raise exception 'authenticated must not write the refresh lease';
  exception when insufficient_privilege then null;
  end;
  -- the owner still reads their own row (status pages), never someone else's
  assert (select count(*) from public.merchants) = 1, 'owner sees exactly their merchant row';
end $$;
reset role;

rollback;
