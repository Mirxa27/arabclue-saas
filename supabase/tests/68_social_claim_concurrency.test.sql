-- SW-9 under real concurrency: two database sessions claim at the same time. While session A
-- still holds its claimed rows (transaction open, rows locked), session B must neither wait for
-- them nor claim them (FOR UPDATE SKIP LOCKED); after A commits nothing is claimable twice.
-- The extra sessions come from dblink (contrib), connected over the local socket; where that is
-- unavailable the test is skipped with a WARNING (the real-stack proof is
-- __tests__/integration/social-publishing.int.test.ts).

create schema if not exists social_test_dblink;
do $$
begin
  create extension if not exists dblink schema social_test_dblink;
exception when others then
  raise warning 'social claim concurrency: dblink unavailable (%), test skipped', sqlerrm;
end $$;

-- Fixtures must be committed: the other sessions cannot see this session's uncommitted rows.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000006801', 'concurrency@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-000000006811', '00000000-0000-4000-8000-000000006801', 'Concurrency', 'plus', 'active');
insert into public.agent_settings (merchant_id, persona_role, enabled, status) values
  ('00000000-0000-4000-8000-000000006811', 'social', true, 'active');
insert into public.social_posts (merchant_id, scheduled_for, platforms, copies, status)
select '00000000-0000-4000-8000-000000006811', now() - make_interval(mins => g), '{x}', '{}', 'scheduled'
  from generate_series(1, 6) g;

do $$
declare
  conn text := format(
    'host=%s port=%s dbname=%s user=%s',
    split_part(current_setting('unix_socket_directories'), ',', 1),
    current_setting('port'),
    current_database(),
    current_user
  );
  claim constant text :=
    $q$select id from public.claim_due_social_posts(%s, array['plus'], array['active'], 21600)$q$;
  a uuid[];
  b uuid[];
  c uuid[];
begin
  if to_regprocedure('social_test_dblink.dblink_connect(text,text)') is null then
    raise warning 'social claim concurrency: dblink not installed, test skipped';
    return;
  end if;
  begin
    perform social_test_dblink.dblink_connect('social_claim_a', conn);
    perform social_test_dblink.dblink_connect('social_claim_b', conn);
  exception when others then
    raise warning 'social claim concurrency: cannot open extra sessions (%), test skipped', sqlerrm;
    return;
  end;

  -- A claims 3 and keeps its transaction (and the row locks) open.
  perform social_test_dblink.dblink_exec('social_claim_a', 'begin');
  select array_agg(id) into a from social_test_dblink.dblink('social_claim_a', format(claim, 3)) as t(id uuid);

  -- B claims while A is mid-flight: it must skip A's rows, not wait for them (a wait would hit
  -- the statement timeout) and not claim them.
  perform social_test_dblink.dblink_exec('social_claim_b', 'set statement_timeout = 5000');
  select array_agg(id) into b from social_test_dblink.dblink('social_claim_b', format(claim, 10)) as t(id uuid);

  assert cardinality(a) = 3, format('session A claimed %s, expected 3', cardinality(a));
  assert cardinality(b) = 3, format('session B claimed %s, expected the other 3', cardinality(b));
  assert not (a && b), format('a post was claimed by both sessions: A=%s B=%s', a, b);

  -- A commits; nothing is left for anyone.
  perform social_test_dblink.dblink_exec('social_claim_a', 'commit');
  select array_agg(id) into c from social_test_dblink.dblink('social_claim_b', format(claim, 10)) as t(id uuid);
  assert c is null, format('after both claims, %s more were claimable', cardinality(c));
  raise notice 'social claim concurrency: session A claimed %, session B claimed % while A held its locks, overlap none',
    cardinality(a), cardinality(b);

  perform social_test_dblink.dblink_disconnect('social_claim_a');
  perform social_test_dblink.dblink_disconnect('social_claim_b');
end $$;

delete from public.merchants where id = '00000000-0000-4000-8000-000000006811';
delete from auth.users where id = '00000000-0000-4000-8000-000000006801';
drop extension if exists dblink;
drop schema if exists social_test_dblink;
