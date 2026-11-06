-- social_begin_plan_run: single flight + daily quota + stale recovery (SW-31)
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000006701', 'plan@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-000000006711', '00000000-0000-4000-8000-000000006701', 'Planner', 'pro', 'active');

do $$
declare
  r record;
  v_first uuid;
  n integer;
  m constant uuid := '00000000-0000-4000-8000-000000006711';
begin
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'started' and r.run_id is not null, format('first run: %s', r.outcome);
  v_first := r.run_id;

  -- a second generation while one is running is refused
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'busy' and r.run_id is null and r.retry_after_seconds > 0, format('second run: %s', r.outcome);

  -- finishing the run frees the slot
  update public.social_plan_runs set status = 'succeeded', finished_at = now() where id = v_first;
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'started', format('after finish: %s', r.outcome);

  -- a crashed run (older than the stale window) is closed as failed instead of locking the merchant out
  update public.social_plan_runs set started_at = now() - interval '20 minutes' where id = r.run_id;
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'started', format('after stale: %s', r.outcome);
  select count(*) into n from public.social_plan_runs where merchant_id = m and status = 'failed' and error = 'timed out';
  assert n = 1, format('stale run must be closed as timed out, got %s', n);

  -- three runs in 24 h: the quota is spent, with a retry hint
  update public.social_plan_runs set status = 'succeeded', finished_at = now() where merchant_id = m and status = 'running';
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'quota_exceeded' and r.run_id is null and r.retry_after_seconds between 1 and 86400,
    format('quota: %s / %s', r.outcome, r.retry_after_seconds);

  -- runs older than 24 h no longer count
  update public.social_plan_runs set started_at = now() - interval '25 hours' where merchant_id = m;
  select * into r from public.social_begin_plan_run(m, 3, 600);
  assert r.outcome = 'started', format('after the window: %s', r.outcome);

  -- privileges: service role only (the merchant cannot reset its own quota)
  assert not has_table_privilege('authenticated', 'public.social_plan_runs', 'select'), 'authenticated must not read plan runs';
  assert not has_table_privilege('authenticated', 'public.social_plan_runs', 'delete'), 'authenticated must not delete plan runs';
  assert not has_table_privilege('anon', 'public.social_plan_runs', 'select'), 'anon must not read plan runs';
  assert has_table_privilege('service_role', 'public.social_plan_runs', 'insert'), 'service_role writes plan runs';
  assert not has_function_privilege('authenticated', 'public.social_begin_plan_run(uuid,integer,integer)', 'execute'), 'authenticated must not begin runs';
  assert has_function_privilege('service_role', 'public.social_begin_plan_run(uuid,integer,integer)', 'execute'), 'service_role begins runs';
  assert (select relrowsecurity from pg_class where oid = 'public.social_plan_runs'::regclass), 'RLS on social_plan_runs';
end $$;

rollback;
