-- activate_ai_employee() (RE-3): the seat check and the switch to `active` in one transaction under
-- the merchant row lock (the two-session race is in 93_employee_concurrency.test.sql); outcomes,
-- what p_patch may change, size bounds, grants.
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000009101', 'activate91@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-000000009102', '00000000-0000-4000-8000-000000009101', 'Activate 91'),
  ('00000000-0000-4000-8000-000000009103', null, 'Other 91');
-- Seats: A1 (active), P1 / P2 / U1 (paused) are non-offboarded = 4; O1 gave its seat up.
insert into public.ai_employees (id, merchant_id, role_id, display_name, status, billing_status, trial_ends_at, next_billing_at, paused_at, offboarded_at, monthly_charge_halalas) values
  ('00000000-0000-4000-8000-0000000091a1', '00000000-0000-4000-8000-000000009102', 'sales-rep', 'A1', 'active', 'trial', now() + interval '5 days', null, null, null, 9900),
  ('00000000-0000-4000-8000-0000000091b1', '00000000-0000-4000-8000-000000009102', 'sales-rep', 'P1', 'paused', 'trial', now() + interval '5 days', null, now() - interval '1 day', null, 9900),
  ('00000000-0000-4000-8000-0000000091b2', '00000000-0000-4000-8000-000000009102', 'sales-rep', 'P2', 'paused', 'active', null, now() + interval '20 days', now() - interval '1 day', null, 9900),
  ('00000000-0000-4000-8000-0000000091c1', '00000000-0000-4000-8000-000000009102', 'sales-rep', 'U1', 'paused', 'past_due', now() - interval '1 day', null, now() - interval '1 day', null, 9900),
  ('00000000-0000-4000-8000-0000000091d1', '00000000-0000-4000-8000-000000009102', 'sales-rep', 'O1', 'offboarded', 'trial', now() + interval '5 days', null, null, now() - interval '1 day', 9900),
  ('00000000-0000-4000-8000-0000000091e1', '00000000-0000-4000-8000-000000009103', 'sales-rep', 'X1', 'paused', 'trial', now() + interval '5 days', null, now(), null, 9900);

set local role service_role;

do $$
declare
  m constant uuid := '00000000-0000-4000-8000-000000009102';
  other constant uuid := '00000000-0000-4000-8000-000000009103';
  a1 constant uuid := '00000000-0000-4000-8000-0000000091a1';
  p1 constant uuid := '00000000-0000-4000-8000-0000000091b1';
  p2 constant uuid := '00000000-0000-4000-8000-0000000091b2';
  u1 constant uuid := '00000000-0000-4000-8000-0000000091c1';
  o1 constant uuid := '00000000-0000-4000-8000-0000000091d1';
  x1 constant uuid := '00000000-0000-4000-8000-0000000091e1';
  r jsonb;
  e public.ai_employees%rowtype;
begin
  -- A paused employee already holds its seat: limit 4 is enough (3 others + itself).
  r := public.activate_ai_employee(m, p1, 4);
  assert r ->> 'outcome' = 'activated', format('resume paused within the limit: %s', r);
  select * into e from public.ai_employees where id = p1;
  assert e.status = 'active' and e.paused_at is null, 'P1 is active with paused_at cleared';
  assert (r -> 'employee' ->> 'id')::uuid = p1 and r -> 'employee' ->> 'status' = 'active', 'the activated row is returned';

  -- An offboarded employee re-takes a seat: 4 others + itself > 4.
  r := public.activate_ai_employee(m, o1, 4);
  assert r ->> 'outcome' = 'seat_limit' and (r ->> 'count')::integer = 4, format('resume over the limit: %s', r);
  assert (select status from public.ai_employees where id = o1) = 'offboarded', 'a refused resume changes nothing';
  r := public.activate_ai_employee(m, o1, 5);
  assert r ->> 'outcome' = 'activated', format('resume offboarded with room: %s', r);
  select * into e from public.ai_employees where id = o1;
  assert e.status = 'active' and e.offboarded_at is null, 'O1 is active with offboarded_at cleared';

  -- The seat must be paid, whatever the limit.
  r := public.activate_ai_employee(m, u1, 50);
  assert r ->> 'outcome' = 'seat_unpaid' and r ->> 'billing_status' = 'past_due', format('unpaid seat: %s', r);
  assert (select status from public.ai_employees where id = u1) = 'paused', 'an unpaid seat stays paused';

  -- Already active (e.g. the other of two concurrent resumes): no seat check, the patch still applies.
  r := public.activate_ai_employee(m, a1, 0, '{"display_name":"A1 renamed"}');
  assert r ->> 'outcome' = 'activated', format('already active: %s', r);
  assert (select display_name from public.ai_employees where id = a1) = 'A1 renamed', 'patch applied to an active employee';

  -- p_patch may change the owner's profile columns only.
  r := public.activate_ai_employee(m, p2, 50, jsonb_build_object(
    'knowledge', 'Opening hours 9-5', 'goals', jsonb_build_array('reply fast'), 'config', jsonb_build_object('persona_name', 'Noura'),
    'avatar', null, 'tone', 'friendly', 'timezone', 'Asia/Dubai',
    -- none of these may be taken from p_patch:
    'status', 'paused', 'billing_status', 'trial', 'merchant_id', other, 'monthly_charge_halalas', 1,
    'next_billing_at', now() + interval '10 years', 'role_id', 'ceo', 'id', gen_random_uuid()));
  assert r ->> 'outcome' = 'activated', format('activate with a patch: %s', r);
  select * into e from public.ai_employees where id = p2;
  assert e.status = 'active' and e.knowledge = 'Opening hours 9-5' and e.goals = '["reply fast"]'::jsonb
     and e.config = '{"persona_name":"Noura"}'::jsonb and e.avatar is null and e.tone = 'friendly'
     and e.timezone = 'Asia/Dubai', format('profile columns applied: %s', to_jsonb(e));
  assert e.billing_status = 'active' and e.merchant_id = m and e.monthly_charge_halalas = 9900
     and e.next_billing_at < now() + interval '1 year' and e.role_id = 'sales-rep',
    format('status, billing and identity columns must not come from p_patch: %s', to_jsonb(e));

  -- Another merchant's employee, or an unknown merchant: nothing found, nothing changed.
  r := public.activate_ai_employee(m, x1, 50);
  assert r ->> 'outcome' = 'employee_not_found', format('cross-merchant: %s', r);
  assert (select status from public.ai_employees where id = x1) = 'paused', 'another merchant''s employee is untouched';
  r := public.activate_ai_employee(gen_random_uuid(), p1, 50);
  assert r ->> 'outcome' = 'merchant_not_found', format('unknown merchant: %s', r);

  -- The size bounds still apply to the patch (the API maps 23514 to 400).
  begin
    perform public.activate_ai_employee(m, o1, 50, jsonb_build_object('goals', (select jsonb_agg(g::text) from generate_series(1, 9) g)));
    raise exception 'a patch breaking a bound must be refused';
  exception when check_violation then null;
  end;
  begin
    perform public.activate_ai_employee(m, p1, 50, '[]'::jsonb);
    raise exception 'a non-object p_patch must be refused';
  exception when sqlstate '22004' then null;
  end;
end $$;

reset role;

do $$
begin
  assert not has_function_privilege('anon', 'public.activate_ai_employee(uuid,uuid,integer,jsonb)', 'EXECUTE'), 'anon must not activate';
  assert not has_function_privilege('authenticated', 'public.activate_ai_employee(uuid,uuid,integer,jsonb)', 'EXECUTE'),
    'authenticated must not activate (seat limit and billing checks live in the API)';
  assert has_function_privilege('service_role', 'public.activate_ai_employee(uuid,uuid,integer,jsonb)', 'EXECUTE'), 'service_role activates';
end $$;

rollback;
