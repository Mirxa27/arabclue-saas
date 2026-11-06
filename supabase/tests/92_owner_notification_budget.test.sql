-- claim_owner_notification() (RE-2): a per-employee, per-channel budget of platform emails to the
-- store owner inside a rolling window, recorded in the employee's activity log; service role only;
-- the owner cannot reset it through the Data API. (The two-session race: 93_employee_concurrency.)
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000009201', 'budget92@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-000000009202', '00000000-0000-4000-8000-000000009201', 'Budget 92');
insert into public.ai_employees (id, merchant_id, role_id, display_name) values
  ('00000000-0000-4000-8000-000000009203', '00000000-0000-4000-8000-000000009202', 'support-agent', 'E1'),
  ('00000000-0000-4000-8000-000000009204', '00000000-0000-4000-8000-000000009202', 'support-agent', 'E2');

set local role service_role;

do $$
declare
  e1 constant uuid := '00000000-0000-4000-8000-000000009203';
  e2 constant uuid := '00000000-0000-4000-8000-000000009204';
  claim bigint;
  i integer;
  n integer;
begin
  for i in 1..3 loop
    claim := public.claim_owner_notification(e1, 'email', 3, 3600, jsonb_build_object('kind', 'escalation', 'n', i));
    assert claim is not null, format('claim %s of 3 must be granted', i);
  end loop;
  assert public.claim_owner_notification(e1, 'email', 3, 3600) is null, 'the 4th claim inside the window is refused';

  -- Each employee and each channel has its own budget.
  assert public.claim_owner_notification(e2, 'email', 3, 3600) is not null, 'another employee is not affected';
  assert public.claim_owner_notification(e1, 'sms', 3, 3600) is not null, 'another channel is not affected';
  assert public.claim_owner_notification(e2, 'email', 0, 3600) is null, 'a zero budget grants nothing';

  -- A claim is a pending entry in the employee's activity log.
  select count(*) into n from public.ai_employee_actions
   where employee_id = e1 and action = 'owner_notification' and channel = 'email' and status = 'retry';
  assert n = 3, format('three pending email claims expected, got %s', n);
  assert (select payload ->> 'kind' from public.ai_employee_actions where id = claim) = 'escalation', 'the payload is kept';

  -- Claims older than the window no longer count.
  update public.ai_employee_actions set created_at = now() - interval '2 hours'
   where employee_id = e1 and action = 'owner_notification' and channel = 'email';
  assert public.claim_owner_notification(e1, 'email', 3, 3600) is not null, 'old claims leave the window';

  begin
    perform public.claim_owner_notification(e1, ' ', 3, 3600);
    raise exception 'a blank channel must be refused';
  exception when sqlstate '22004' then null;
  end;
  begin
    perform public.claim_owner_notification(e1, 'email', 3, 0);
    raise exception 'a non-positive window must be refused';
  exception when sqlstate '22004' then null;
  end;
  begin
    perform public.claim_owner_notification(e1, 'email', 3, 3600, '[1]'::jsonb);
    raise exception 'a non-object payload must be refused';
  exception when sqlstate '22004' then null;
  end;
end $$;

reset role;

do $$
begin
  assert not has_function_privilege('anon', 'public.claim_owner_notification(uuid,text,integer,integer,jsonb)', 'EXECUTE'), 'anon must not claim';
  assert not has_function_privilege('authenticated', 'public.claim_owner_notification(uuid,text,integer,integer,jsonb)', 'EXECUTE'),
    'authenticated must not claim';
  assert has_function_privilege('service_role', 'public.claim_owner_notification(uuid,text,integer,integer,jsonb)', 'EXECUTE'), 'service_role claims';
end $$;

-- The owner sees the log but cannot reset the budget through the Data API.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009201","role":"authenticated"}', true);
do $$
declare
  n integer;
begin
  select count(*) into n from public.ai_employee_actions where action = 'owner_notification';
  assert n > 0, 'the owner can read the claims in the activity log';
  begin
    delete from public.ai_employee_actions where action = 'owner_notification';
    raise exception 'the owner must not delete claims';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_employee_actions set created_at = now() - interval '1 day' where action = 'owner_notification';
    raise exception 'the owner must not age claims';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
