-- RB-S2 (20261106007200_salla_lifecycle_ordering.sql): app.store.authorize / app.uninstalled are
-- applied in Salla's event order. A late or retried uninstall must not wipe a newer reinstall; a
-- late older authorization must not bring revoked tokens back. Fixtures are rolled back.

-- ── privileges ────────────────────────────────────────────────────────────────
do $$
declare
  p text;
  f text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.salla_store_lifecycle'::regclass), 'RLS must be on for salla_store_lifecycle';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salla_store_lifecycle'), 'service-role only: no policies';
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('anon', 'public.salla_store_lifecycle', p), format('anon must not have %s on salla_store_lifecycle', p);
    assert not has_table_privilege('authenticated', 'public.salla_store_lifecycle', p), format('authenticated must not have %s on salla_store_lifecycle', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert has_table_privilege('service_role', 'public.salla_store_lifecycle', p), format('service_role needs %s on salla_store_lifecycle', p);
  end loop;
  foreach f in array array[
    'public.salla_record_uninstall(text,timestamptz)',
    'public.salla_apply_authorization(text,text,text,timestamptz,timestamptz,text,text,text,text,text)',
    'public.salla_link_store_at(uuid,text,text,text,timestamptz,text,timestamptz)',
    'public.salla_lifecycle_note(text,timestamptz,timestamptz)',
    'public.salla_link_store(uuid,text,text,text,timestamptz,text)',
    'public.salla_record_authorization(text,text,text,timestamptz,text,text,text,text,text)',
    'public.salla_claim_install(uuid,text,text)'] loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon must not execute %s', f);
    assert not has_function_privilege('authenticated', f, 'execute'), format('authenticated must not execute %s', f);
    assert has_function_privilege('service_role', f, 'execute'), format('service_role must execute %s', f);
  end loop;
  -- one version of each RPC: PostgREST resolves them by name
  assert (select count(*) from pg_proc where proname = 'salla_record_authorization' and pronamespace = 'public'::regnamespace) = 1,
    'salla_record_authorization must not be overloaded';
  assert (select count(*) from pg_proc where proname = 'salla_link_store' and pronamespace = 'public'::regnamespace) = 1,
    'salla_link_store must not be overloaded';
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000082a1', 'a@lifecycle.example'),
  ('00000000-0000-4000-8000-0000000082b1', 'b@lifecycle.example');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000082a2', '00000000-0000-4000-8000-0000000082a1', 'A'),
  ('00000000-0000-4000-8000-0000000082b2', '00000000-0000-4000-8000-0000000082b1', 'B');

-- ── the RB-S2 scenario: a retried uninstall after a reinstall ─────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000082a2';
  t0 constant timestamptz := now() - interval '1 hour';
  r jsonb;
begin
  -- Custom Mode link an hour ago (its authorization time is the link time)
  r := public.salla_link_store_at(a, '82001', 'enc:v1:at-1', 'enc:v1:rt-1', t0 + interval '14 days', 'Store', t0);
  assert r ->> 'outcome' = 'linked', format('link: %s', r);

  -- 10:00 uninstall (the events-log write fails → Salla retries in ~5 minutes)
  r := public.salla_record_uninstall('82001', t0 + interval '10 minutes');
  assert r ->> 'outcome' = 'uninstalled' and (r ->> 'merchant_id')::uuid = a, format('uninstall: %s', r);
  assert (select access_token is null and refresh_token is null and token_expires_at is null and uninstalled_at is not null
            from public.merchants where id = a), 'uninstall clears the tokens';

  -- 10:02 reinstall: Easy Mode authorization with fresh tokens
  r := public.salla_apply_authorization('82001', 'enc:v1:at-2', 'enc:v1:rt-2', t0 + interval '15 days', t0 + interval '12 minutes');
  assert r ->> 'outcome' = 'linked_updated', format('reinstall: %s', r);
  assert (select access_token = 'enc:v1:at-2' and uninstalled_at is null from public.merchants where id = a), 'reinstall reconnected';

  -- 10:05 the 10:00 uninstall is redelivered: stale, the reinstall's tokens survive
  r := public.salla_record_uninstall('82001', t0 + interval '10 minutes');
  assert r ->> 'outcome' = 'stale', format('redelivered uninstall: %s', r);
  assert (select access_token = 'enc:v1:at-2' and refresh_token = 'enc:v1:rt-2' and uninstalled_at is null
            from public.merchants where id = a), 'a late uninstall must not wipe a newer reinstall';

  -- the converse: a real uninstall at 10:20, then the 10:12 authorization is redelivered
  r := public.salla_record_uninstall('82001', t0 + interval '20 minutes');
  assert r ->> 'outcome' = 'uninstalled', format('second uninstall: %s', r);
  r := public.salla_apply_authorization('82001', 'enc:v1:at-2', 'enc:v1:rt-2', t0 + interval '15 days', t0 + interval '12 minutes');
  assert r ->> 'outcome' = 'stale', format('older authorization after uninstall: %s', r);
  assert (select access_token is null and uninstalled_at is not null from public.merchants where id = a),
    'revoked tokens must not come back';

  -- a genuinely newer authorization reconnects
  r := public.salla_apply_authorization('82001', 'enc:v1:at-3', 'enc:v1:rt-3', t0 + interval '16 days', t0 + interval '30 minutes');
  assert r ->> 'outcome' = 'linked_updated', format('newer authorization: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:at-3', 'newest tokens stored';
  assert (select authorized_event_at = t0 + interval '30 minutes' and uninstalled_event_at = t0 + interval '20 minutes'
            from public.salla_store_lifecycle where salla_merchant_id = '82001'), 'watermarks track the newest events';

  -- the expiry check between authorizations still applies (redelivery after a token refresh)
  r := public.salla_apply_authorization('82001', 'enc:v1:at-old', null, t0 + interval '15 days', t0 + interval '31 minutes');
  assert r ->> 'outcome' = 'stale', format('earlier expiry: %s', r);
end $$;

-- ── Custom Mode reconnect after an uninstall; then the uninstall is redelivered ──
do $$
declare
  b constant uuid := '00000000-0000-4000-8000-0000000082b2';
  r jsonb;
begin
  r := public.salla_record_uninstall('82002', now() - interval '5 minutes'); -- store not linked yet: just recorded
  assert r ->> 'outcome' = 'uninstalled' and r ->> 'merchant_id' is null, format('unlinked uninstall: %s', r);
  r := public.salla_link_store(b, '82002', 'enc:v1:oauth', 'enc:v1:oauth-rt', now() + interval '14 days', 'B Store');
  assert r ->> 'outcome' = 'linked', format('oauth link: %s', r);
  r := public.salla_record_uninstall('82002', now() - interval '5 minutes');
  assert r ->> 'outcome' = 'stale', format('uninstall older than the OAuth link: %s', r);
  assert (select access_token from public.merchants where id = b) = 'enc:v1:oauth', 'OAuth tokens survive';
end $$;

-- ── unlinked stores: parked Easy Mode installs follow the same order ──────────
do $$
declare
  t0 constant timestamptz := now() - interval '2 hours';
  r jsonb;
begin
  r := public.salla_apply_authorization('82100', 'enc:v1:p1', 'enc:v1:p1-rt', t0 + interval '14 days', t0, null,
                                        'owner@lifecycle.example', 'user');
  assert r ->> 'outcome' = 'pending_saved', format('park: %s', r);
  r := public.salla_record_uninstall('82100', t0 + interval '1 minute');
  assert r ->> 'outcome' = 'uninstalled', format('uninstall parked: %s', r);
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '82100'), 'parked install dropped';

  r := public.salla_apply_authorization('82100', 'enc:v1:p1', 'enc:v1:p1-rt', t0 + interval '14 days', t0);
  assert r ->> 'outcome' = 'stale', format('late older authorization: %s', r);
  assert not exists (select 1 from public.salla_installs where salla_merchant_id = '82100'), 'revoked tokens not parked again';

  r := public.salla_apply_authorization('82100', 'enc:v1:p2', null, t0 + interval '15 days', t0 + interval '5 minutes', null,
                                        'owner@lifecycle.example', 'user');
  assert r ->> 'outcome' = 'pending_saved', format('reinstall parked: %s', r);
end $$;

-- ── a claim links the parked authorization without moving its time ───────────
do $$
declare
  b constant uuid := '00000000-0000-4000-8000-0000000082b2';
  t constant timestamptz := now() - interval '30 minutes';
  r jsonb;
begin
  update public.merchants set salla_merchant_id = null, access_token = null where id = b; -- B disconnects 82002
  r := public.salla_apply_authorization('82200', 'enc:v1:c', 'enc:v1:c-rt', now() + interval '14 days', t, null,
                                        'b@lifecycle.example', 'user');
  assert r ->> 'outcome' = 'pending_saved', format('park for claim: %s', r);
  r := public.salla_claim_install(b, '82200', 'b@lifecycle.example');
  assert r ->> 'outcome' = 'linked', format('claim: %s', r);
  assert (select authorized_event_at from public.salla_store_lifecycle where salla_merchant_id = '82200') = t,
    'the claimed authorization keeps its own event time';
  -- the uninstall that happened after that authorization (delivered late) still applies
  r := public.salla_record_uninstall('82200', t + interval '1 minute');
  assert r ->> 'outcome' = 'uninstalled', format('late uninstall after claim: %s', r);
  assert (select access_token is null from public.merchants where id = b), 'revoked tokens cleared';
end $$;

-- ── unknown event time: the previous, unordered behaviour ─────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000082a2';
  r jsonb;
begin
  r := public.salla_record_uninstall('82001', null);
  assert r ->> 'outcome' = 'uninstalled', format('uninstall without time: %s', r);
  r := public.salla_record_authorization('82001', 'enc:v1:wrapper', 'enc:v1:wrapper-rt', now() + interval '20 days');
  assert r ->> 'outcome' = 'linked_updated', format('legacy entry point: %s', r);
  assert (select access_token from public.merchants where id = a) = 'enc:v1:wrapper', 'salla_record_authorization still applies';

  begin
    perform public.salla_record_uninstall('  ');
    raise exception 'blank store id must be rejected';
  exception when sqlstate '22004' then null;
  end;
end $$;

-- ── never reachable from a user session ───────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000082a1","role":"authenticated"}', true) as jwt_claims \gset
do $$
begin
  begin
    perform public.salla_record_uninstall('82001');
    raise exception 'authenticated must not call salla_record_uninstall';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.salla_store_lifecycle;
    raise exception 'authenticated must not read salla_store_lifecycle';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
