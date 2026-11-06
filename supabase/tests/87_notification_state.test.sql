-- UI-016 (20261106007600_notifications_and_overview.sql): the notifications read cursor is the
-- owner's own row, only moves forward, never past now(), and cannot be written for another
-- merchant. Fixtures are rolled back at the end.

do $$
declare
  p text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.merchant_notification_state'::regclass), 'RLS must be on';
  assert has_table_privilege('authenticated', 'public.merchant_notification_state', 'SELECT'), 'owners read their cursor';
  assert has_column_privilege('authenticated', 'public.merchant_notification_state', 'last_seen_at', 'UPDATE'), 'owners move their cursor';
  assert not has_column_privilege('authenticated', 'public.merchant_notification_state', 'merchant_id', 'UPDATE'), 'the owner column is fixed';
  foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('authenticated', 'public.merchant_notification_state', p), format('authenticated must not have %s', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert not has_table_privilege('anon', 'public.merchant_notification_state', p), format('anon must not have %s', p);
    assert has_table_privilege('service_role', 'public.merchant_notification_state', p), format('service_role needs %s', p);
  end loop;
  assert not has_function_privilege('anon', 'public.mark_notifications_seen(uuid,timestamptz)', 'execute'), 'anon must not mark';
  assert has_function_privilege('authenticated', 'public.mark_notifications_seen(uuid,timestamptz)', 'execute'), 'owners mark as seen';
  assert has_function_privilege('service_role', 'public.mark_notifications_seen(uuid,timestamptz)', 'execute'), 'service_role marks as seen';
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000087a1', 'bell-a@example.test'),
  ('00000000-0000-4000-8000-0000000087b1', 'bell-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000087a2', '00000000-0000-4000-8000-0000000087a1', 'Bell A'),
  ('00000000-0000-4000-8000-0000000087b2', '00000000-0000-4000-8000-0000000087b1', 'Bell B');
insert into public.merchant_notification_state (merchant_id, last_seen_at)
values ('00000000-0000-4000-8000-0000000087b2', '2026-11-01 00:00:00+00');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000087a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000087a2';
  b constant uuid := '00000000-0000-4000-8000-0000000087b2';
  t timestamptz;
begin
  t := public.mark_notifications_seen(a, '2026-11-02 10:00:00+00');
  assert t = '2026-11-02 10:00:00+00', format('first mark stores the cursor, got %s', t);
  t := public.mark_notifications_seen(a, '2026-11-01 00:00:00+00');
  assert t = '2026-11-02 10:00:00+00', format('an older mark never moves the cursor back, got %s', t);
  t := public.mark_notifications_seen(a, now() + interval '30 days');
  assert t <= now(), format('the cursor never moves past now(), got %s', t);
  t := public.mark_notifications_seen(a);
  assert t = now(), format('default marks up to now, got %s', t);

  assert (select count(*) from public.merchant_notification_state) = 1, 'owner A sees only their own cursor';

  begin
    perform public.mark_notifications_seen(b, now());
    assert false, 'marking another merchant''s notifications must fail';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$
begin
  assert (select last_seen_at from public.merchant_notification_state where merchant_id = '00000000-0000-4000-8000-0000000087b2')
    = '2026-11-01 00:00:00+00', 'B''s cursor is untouched';
end $$;

rollback;
