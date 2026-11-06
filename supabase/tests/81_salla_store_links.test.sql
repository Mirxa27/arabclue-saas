-- RB-S1 (20261106007100_salla_store_links.sql): every Salla store a merchant has linked is kept in
-- salla_store_links (Disconnect clears merchants.salla_merchant_id), and
-- salla_merchant_event_windows() gives PDPL erasure/export the store keys with the time window of
-- the store's events that belong to the merchant. Fixtures are rolled back at the end.

-- ── privileges ────────────────────────────────────────────────────────────────
do $$
declare
  p text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.salla_store_links'::regclass), 'RLS must be on for salla_store_links';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salla_store_links'), 'service-role only: no policies';
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('anon', 'public.salla_store_links', p), format('anon must not have %s on salla_store_links', p);
    assert not has_table_privilege('authenticated', 'public.salla_store_links', p), format('authenticated must not have %s on salla_store_links', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert has_table_privilege('service_role', 'public.salla_store_links', p), format('service_role needs %s on salla_store_links', p);
  end loop;
  assert not has_sequence_privilege('anon', 'public.salla_store_links_id_seq', 'USAGE'), 'anon must not use the links sequence';
  assert not has_sequence_privilege('authenticated', 'public.salla_store_links_id_seq', 'USAGE'), 'authenticated must not use the links sequence';
  assert has_sequence_privilege('service_role', 'public.salla_store_links_id_seq', 'USAGE'), 'service_role uses the links sequence';

  assert not has_function_privilege('anon', 'public.salla_merchant_event_windows(uuid)', 'execute'), 'anon must not read store windows';
  assert not has_function_privilege('authenticated', 'public.salla_merchant_event_windows(uuid)', 'execute'), 'authenticated must not read store windows';
  assert has_function_privilege('service_role', 'public.salla_merchant_event_windows(uuid)', 'execute'), 'service_role reads store windows';
  assert not has_function_privilege('anon', 'public.salla_store_links_track()', 'execute'), 'trigger function is not callable';
  assert not has_function_privilege('authenticated', 'public.salla_store_links_track()', 'execute'), 'trigger function is not callable';
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000081a1', 'a@links.example'),
  ('00000000-0000-4000-8000-0000000081b1', 'b@links.example');

-- ── the trigger records every change of merchants.salla_merchant_id ──────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000081a2';
  b constant uuid := '00000000-0000-4000-8000-0000000081b2';
  n integer;
begin
  insert into public.merchants (id, owner_user_id, seller_name, salla_merchant_id)
  values (a, '00000000-0000-4000-8000-0000000081a1', 'A', '81001'),
         (b, '00000000-0000-4000-8000-0000000081b1', 'B', null);
  assert (select count(*) from public.salla_store_links where merchant_id = a and salla_merchant_id = '81001' and unlinked_at is null) = 1,
    'linking on insert opens a period';
  assert not exists (select 1 from public.salla_store_links where merchant_id = b), 'no store, no period';

  -- unrelated updates do not touch the history
  update public.merchants set seller_name = 'A renamed' where id = a;
  assert (select count(*) from public.salla_store_links where merchant_id = a) = 1, 'unrelated update changes nothing';

  -- Disconnect (unlinkSallaStore) clears the store id: the period is closed, not lost
  update public.merchants set salla_merchant_id = null, access_token = null where id = a;
  assert (select unlinked_at is not null from public.salla_store_links where merchant_id = a and salla_merchant_id = '81001'),
    'disconnect closes the period';

  -- B links the same store (salla_link_store), then disconnects; A links it again
  perform public.salla_link_store(b, '81001', 'enc:v1:b', null, null, 'Store');
  assert (select count(*) from public.salla_store_links where merchant_id = b and salla_merchant_id = '81001' and unlinked_at is null) = 1,
    'salla_link_store opens a period for B';
  update public.merchants set salla_merchant_id = null where id = b;
  perform public.salla_link_store(a, '81001', 'enc:v1:a2', null, null, 'Store');
  select count(*) into n from public.salla_store_links where salla_merchant_id = '81001';
  assert n = 3, format('three periods of store 81001, got %s', n);
  assert (select count(*) from public.salla_store_links where salla_merchant_id = '81001' and unlinked_at is null) = 1,
    'one open period per store';

  -- switching stores closes the old period and opens the new one
  update public.merchants set salla_merchant_id = '81002' where id = a;
  assert (select count(*) from public.salla_store_links where merchant_id = a and unlinked_at is null) = 1, 'one open period per merchant';
  assert (select salla_merchant_id from public.salla_store_links where merchant_id = a and unlinked_at is null) = '81002', 'new store recorded';
end $$;

-- ── event windows: a store's events belong to whoever linked it last before them ──
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000081a2';
  b constant uuid := '00000000-0000-4000-8000-0000000081b2';
  l_a1 timestamptz;
  l_b timestamptz;
  l_a2 timestamptz;
  l_s2 timestamptz;
  w record;
  n integer;
begin
  select linked_at into l_a1 from public.salla_store_links where merchant_id = a and salla_merchant_id = '81001' order by linked_at limit 1;
  select linked_at into l_b from public.salla_store_links where merchant_id = b and salla_merchant_id = '81001';
  select linked_at into l_a2 from public.salla_store_links where merchant_id = a and salla_merchant_id = '81001' order by linked_at desc limit 1;
  select linked_at into l_s2 from public.salla_store_links where merchant_id = a and salla_merchant_id = '81002';
  assert l_a1 < l_b and l_b < l_a2 and l_a2 < l_s2, 'periods are ordered in time (clock_timestamp)';

  -- A: store 81001 before B's link (incl. everything before the first link), again from its
  -- relink until … forever (nobody linked it after), and store 81002 from its link on
  select count(*) into n from public.salla_merchant_event_windows(a);
  assert n = 3, format('A has 3 windows, got %s', n);
  assert exists (select 1 from public.salla_merchant_event_windows(a) x where x.salla_merchant_id = '81001' and x.from_at is null and x.to_at = l_b),
    'A owns 81001 up to B''s link';
  assert exists (select 1 from public.salla_merchant_event_windows(a) x where x.salla_merchant_id = '81001' and x.from_at = l_a2 and x.to_at is null),
    'A owns 81001 again from its relink';
  assert exists (select 1 from public.salla_merchant_event_windows(a) x where x.salla_merchant_id = '81002' and x.from_at is null and x.to_at is null),
    'A is the only linker of 81002';

  -- B: only its own period of 81001
  select count(*) into n from public.salla_merchant_event_windows(b);
  assert n = 1, format('B has 1 window, got %s', n);
  select * into w from public.salla_merchant_event_windows(b);
  assert w.salla_merchant_id = '81001' and w.from_at = l_b and w.to_at = l_a2, format('B owns [l_b, l_a2): %s', row_to_json(w));

  -- unknown merchant: nothing
  assert not exists (select 1 from public.salla_merchant_event_windows('00000000-0000-4000-8000-00000000ffff')), 'no windows for strangers';

  -- PDPL erasure of B keeps its period without the merchant id, so A's window stays bounded
  delete from public.merchants where id = b;
  assert exists (select 1 from public.salla_store_links where merchant_id is null and salla_merchant_id = '81001' and linked_at = l_b
                   and unlinked_at is not null), 'erased merchant''s period survives anonymised';
  assert exists (select 1 from public.salla_merchant_event_windows(a) x where x.salla_merchant_id = '81001' and x.from_at is null and x.to_at = l_b),
    'A''s window still ends where B''s period began';

  -- deleting a merchant that holds a store closes its open period
  delete from public.merchants where id = a;
  assert not exists (select 1 from public.salla_store_links where unlinked_at is null and salla_merchant_id in ('81001', '81002')),
    'delete closes the open periods';
end $$;

rollback;
