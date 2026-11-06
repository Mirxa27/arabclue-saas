-- ai_employee_tasks ownership columns (SW-5): defaults, checks, payload bound, owner-only writes.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000006b1', 'tasks-a@example.test'),
  ('00000000-0000-4000-8000-0000000006b2', 'tasks-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000006b3', '00000000-0000-4000-8000-0000000006b1', 'Tasks A'),
  ('00000000-0000-4000-8000-0000000006b4', '00000000-0000-4000-8000-0000000006b2', 'Tasks B');
insert into public.ai_employees (id, merchant_id, role_id, display_name) values
  ('00000000-0000-4000-8000-0000000006b5', '00000000-0000-4000-8000-0000000006b3', 'sales-rep', 'A1'),
  ('00000000-0000-4000-8000-0000000006b6', '00000000-0000-4000-8000-0000000006b4', 'sales-rep', 'B1');

do $$
declare
  t public.ai_employee_tasks%rowtype;
begin
  insert into public.ai_employee_tasks (employee_id, title) values ('00000000-0000-4000-8000-0000000006b5', 'plain')
    returning * into t;
  assert t.assignee = 'agent' and t.kind = 'task' and t.payload is null, 'defaults: agent / task / no payload';

  begin
    insert into public.ai_employee_tasks (employee_id, title, assignee) values ('00000000-0000-4000-8000-0000000006b5', 'x', 'robot');
    raise exception 'assignee must be agent or human';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_employee_tasks (employee_id, title, kind) values ('00000000-0000-4000-8000-0000000006b5', 'x', 'pwn');
    raise exception 'kind must be one of the known kinds';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_employee_tasks (employee_id, title, payload) values ('00000000-0000-4000-8000-0000000006b5', 'x', '[1,2]');
    raise exception 'payload must be an object';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_employee_tasks (employee_id, title, payload)
      values ('00000000-0000-4000-8000-0000000006b5', 'x', jsonb_build_object('body', repeat('x', 17000)));
    raise exception 'payload must be bounded';
  exception when check_violation then null;
  end;
end $$;

-- The owner can file a to-do for themselves; another merchant's employee is out of reach.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006b1","role":"authenticated"}', true);
do $$
declare
  n integer;
begin
  insert into public.ai_employee_tasks (employee_id, title, assignee, kind, payload)
    values ('00000000-0000-4000-8000-0000000006b5', 'call the supplier', 'human', 'task', '{"origin":"merchant"}');
  select count(*) into n from public.ai_employee_tasks where employee_id = '00000000-0000-4000-8000-0000000006b5' and assignee = 'human';
  assert n = 1, 'owner task visible';
  begin
    insert into public.ai_employee_tasks (employee_id, title) values ('00000000-0000-4000-8000-0000000006b6', 'cross-tenant');
    raise exception 'tasks on another merchant''s employee must be refused';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
