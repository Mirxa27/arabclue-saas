-- Two-session races, with a real second backend (dblink):
--  * RE-3 activate_ai_employee(): with one seat left, two resumes run at once. The second waits on
--    the merchant row lock the first transaction holds and, once that commits, sees the seat
--    taken (seat_limit) — instead of both passing a count and going over the plan's limit.
--  * RE-2 claim_owner_notification(): with one email left in the budget, the second claim waits
--    on the per-employee advisory lock and is refused once the first commits.
-- Needs the dblink extension (not yet installed) and a superuser that can reach its own database
-- over the local socket — as in the local `npm run db:test`. Elsewhere it is skipped with a NOTICE.
-- The rows are committed (the peer must see them) and removed at the end.

\set peer_open false
select (not exists (select 1 from pg_extension where extname = 'dblink'))
   and exists (select 1 from pg_available_extensions where name = 'dblink')
   and coalesce((select rolsuper from pg_roles where rolname = current_user), false) as can_dblink \gset

\if :can_dblink
create schema db_test_dblink;
create extension dblink schema db_test_dblink;
create function pg_temp.open_peer() returns boolean
language plpgsql
as $$
begin
  perform db_test_dblink.dblink_connect('peer', format('dbname=%s host=%s port=%s user=%s',
    current_database(), split_part(current_setting('unix_socket_directories'), ',', 1),
    current_setting('port'), current_user));
  perform db_test_dblink.dblink_exec('peer', 'set role service_role');
  return true;
exception when others then
  return false;
end $$;
-- Waits until backend `pid` is blocked on a lock (at most ~10 s).
create function pg_temp.wait_until_blocked(pid integer) returns boolean
language plpgsql
as $$
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity a where a.pid = wait_until_blocked.pid and a.wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;
select pg_temp.open_peer() as peer_open \gset
\endif

\if :peer_open
create temp table race_results (step text primary key, outcome text);
select set_config('race.peer_pid', pid::text, false)
  from db_test_dblink.dblink('peer', 'select pg_backend_pid()') as t(pid integer);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000009301', 'race93@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-000000009302', '00000000-0000-4000-8000-000000009301', 'Race 93');
insert into public.ai_employees (id, merchant_id, role_id, display_name, status, billing_status, trial_ends_at, offboarded_at) values
  ('00000000-0000-4000-8000-0000000093a1', '00000000-0000-4000-8000-000000009302', 'sales-rep', 'Seated', 'active', 'trial', now() + interval '5 days', null),
  ('00000000-0000-4000-8000-0000000093b1', '00000000-0000-4000-8000-000000009302', 'sales-rep', 'Back 1', 'offboarded', 'trial', now() + interval '5 days', now()),
  ('00000000-0000-4000-8000-0000000093b2', '00000000-0000-4000-8000-000000009302', 'sales-rep', 'Back 2', 'offboarded', 'trial', now() + interval '5 days', now());

-- RE-3: plan limit 2, one seat taken — only one of the two resumes may succeed.
begin;
insert into race_results
  select 'resume_first', public.activate_ai_employee('00000000-0000-4000-8000-000000009302', '00000000-0000-4000-8000-0000000093b1', 2) ->> 'outcome';
select db_test_dblink.dblink_send_query('peer',
  $q$select public.activate_ai_employee('00000000-0000-4000-8000-000000009302', '00000000-0000-4000-8000-0000000093b2', 2)::text$q$);
insert into race_results
  select 'resume_peer_waited', pg_temp.wait_until_blocked(current_setting('race.peer_pid')::integer)::text;
commit;
insert into race_results
  select 'resume_second', r::jsonb ->> 'outcome' from db_test_dblink.dblink_get_result('peer') as t(r text);
select count(*) from db_test_dblink.dblink_get_result('peer') as t(r text);

-- RE-2: a budget of one email — only one of the two claims may be granted.
begin;
insert into race_results
  select 'claim_first', (public.claim_owner_notification('00000000-0000-4000-8000-0000000093a1', 'email', 1, 3600) is not null)::text;
select db_test_dblink.dblink_send_query('peer',
  $q$select (public.claim_owner_notification('00000000-0000-4000-8000-0000000093a1', 'email', 1, 3600) is not null)::text$q$);
insert into race_results
  select 'claim_peer_waited', pg_temp.wait_until_blocked(current_setting('race.peer_pid')::integer)::text;
commit;
insert into race_results
  select 'claim_second', r from db_test_dblink.dblink_get_result('peer') as t(r text);
select count(*) from db_test_dblink.dblink_get_result('peer') as t(r text);

do $$
declare
  seated integer;
  claims integer;
  res jsonb;
begin
  select jsonb_object_agg(step, outcome) into res from race_results;
  assert res ->> 'resume_first' = 'activated', format('first resume: %s', res);
  assert res ->> 'resume_peer_waited' = 'true', format('the second resume must wait on the merchant lock: %s', res);
  assert res ->> 'resume_second' = 'seat_limit', format('the second resume must see the seat taken: %s', res);
  select count(*) into seated from public.ai_employees
   where merchant_id = '00000000-0000-4000-8000-000000009302' and status <> 'offboarded';
  assert seated = 2, format('exactly the plan limit is seated, got %s', seated);

  assert res ->> 'claim_first' = 'true', format('first claim: %s', res);
  assert res ->> 'claim_peer_waited' = 'true', format('the second claim must wait on the budget lock: %s', res);
  assert res ->> 'claim_second' = 'false', format('the second claim must be refused: %s', res);
  select count(*) into claims from public.ai_employee_actions
   where employee_id = '00000000-0000-4000-8000-0000000093a1' and action = 'owner_notification';
  assert claims = 1, format('exactly one claim is recorded, got %s', claims);
end $$;

select db_test_dblink.dblink_disconnect('peer');
delete from public.merchants where id = '00000000-0000-4000-8000-000000009302';
delete from auth.users where id = '00000000-0000-4000-8000-000000009301';
\else
do $$ begin raise notice '93_employee_concurrency: skipped (needs dblink and a local superuser connection)'; end $$;
\endif

\if :can_dblink
drop extension dblink;
drop schema db_test_dblink;
\endif
