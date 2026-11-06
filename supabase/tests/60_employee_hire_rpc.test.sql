-- hire_ai_employee() (SW-39): count-and-insert under the merchant row lock, service role only.
-- (Concurrency itself — a second session blocking on the lock and then seeing the new row — is
-- shown against the real stack in the stream's E2E notes; here: outcomes, injection, grants.)
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000006a1', 'hire-rpc@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000006a2', '00000000-0000-4000-8000-0000000006a1', 'Hire RPC Store'),
  ('00000000-0000-4000-8000-0000000006a3', null, 'Other Store');
insert into public.ai_employees (merchant_id, role_id, display_name, status) values
  ('00000000-0000-4000-8000-0000000006a2', 'sales-rep', 'Existing', 'active'),
  ('00000000-0000-4000-8000-0000000006a2', 'sales-rep', 'Gone', 'offboarded');

set local role service_role;

do $$
declare
  m constant uuid := '00000000-0000-4000-8000-0000000006a2';
  other constant uuid := '00000000-0000-4000-8000-0000000006a3';
  r jsonb;
  n integer;
begin
  -- 1 seated (the offboarded one does not count), limit 2 → hired
  r := public.hire_ai_employee(m, 2, jsonb_build_object(
    'role_id', 'support-agent', 'display_name', 'Second', 'billing_status', 'trial',
    'trial_ends_at', now() + interval '7 days', 'monthly_charge_halalas', 14900, 'status', 'active',
    -- these must not be taken from p_row:
    'merchant_id', other, 'id', '00000000-0000-4000-8000-0000000006ff', 'last_billing_payment_id', null,
    'next_billing_at', now() + interval '10 years'));
  assert r ->> 'outcome' = 'hired', format('first hire: %s', r);
  assert (r -> 'employee' ->> 'merchant_id')::uuid = m, 'merchant_id must come from p_merchant_id, never p_row';
  assert (r -> 'employee' ->> 'id') <> '00000000-0000-4000-8000-0000000006ff', 'id must not be injectable';
  assert r -> 'employee' ->> 'next_billing_at' is null, 'billing period must not be injectable';
  assert (r -> 'employee' ->> 'monthly_charge_halalas')::integer = 14900, 'listed columns are taken from p_row';

  -- at the limit → seat_limit, nothing inserted
  r := public.hire_ai_employee(m, 2, jsonb_build_object('role_id', 'sales-rep', 'display_name', 'Third'));
  assert r ->> 'outcome' = 'seat_limit', format('at the limit: %s', r);
  assert (r ->> 'count')::integer = 2, format('seat count: %s', r);

  -- same role + name → duplicate (unique (merchant_id, role_id, display_name))
  r := public.hire_ai_employee(m, 5, jsonb_build_object('role_id', 'support-agent', 'display_name', 'Second'));
  assert r ->> 'outcome' = 'duplicate', format('duplicate: %s', r);

  r := public.hire_ai_employee(gen_random_uuid(), 5, jsonb_build_object('role_id', 'sales-rep', 'display_name', 'X'));
  assert r ->> 'outcome' = 'merchant_not_found', format('unknown merchant: %s', r);

  -- p_limit 0 (e.g. lite) never hires
  r := public.hire_ai_employee(other, 0, jsonb_build_object('role_id', 'sales-rep', 'display_name', 'Y'));
  assert r ->> 'outcome' = 'seat_limit', format('zero-seat plan: %s', r);

  select count(*) into n from public.ai_employees where merchant_id = m and status <> 'offboarded';
  assert n = 2, format('exactly the limit must be seated, got %s', n);
  select count(*) into n from public.ai_employees where merchant_id = other;
  assert n = 0, 'nothing may land on another merchant';

  begin
    perform public.hire_ai_employee(m, 2, '[]'::jsonb);
    raise exception 'a non-object p_row must be refused';
  exception when sqlstate '22004' then null;
  end;
end $$;

reset role;

do $$
begin
  assert not has_function_privilege('anon', 'public.hire_ai_employee(uuid,integer,jsonb)', 'EXECUTE'), 'anon must not hire';
  assert not has_function_privilege('authenticated', 'public.hire_ai_employee(uuid,integer,jsonb)', 'EXECUTE'), 'authenticated must not hire (billing columns)';
  assert has_function_privilege('service_role', 'public.hire_ai_employee(uuid,integer,jsonb)', 'EXECUTE'), 'service_role hires';
end $$;

rollback;
