-- 20261106009000_employee_bounds_repair (RE-1, RE-5, RE-6):
--  * every size bound on ai_employees / ai_employee_messages / ai_employee_tasks is VALIDATED;
--  * the owner cannot write oversized chat history or task text through the Data API, but can
--    write right up to the bounds the API uses;
--  * the goals bound covers what the API accepts (8 × 200 characters, worst-case serialisation).
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000009001', 'bounds90@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-000000009002', '00000000-0000-4000-8000-000000009001', 'Bounds 90');
insert into public.ai_employees (id, merchant_id, role_id, display_name) values
  ('00000000-0000-4000-8000-000000009003', '00000000-0000-4000-8000-000000009002', 'sales-rep', 'Layla');
insert into public.ai_employee_conversations (id, employee_id, channel, external_id) values
  ('00000000-0000-4000-8000-000000009004', '00000000-0000-4000-8000-000000009003', 'dashboard', 'dashboard:90');

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('public.ai_employees', 'ai_employees_config_size'),
      ('public.ai_employees', 'ai_employees_knowledge_size'),
      ('public.ai_employees', 'ai_employees_goals_size'),
      ('public.ai_employees', 'ai_employees_display_name_size'),
      ('public.ai_employee_messages', 'ai_employee_messages_content_size'),
      ('public.ai_employee_tasks', 'ai_employee_tasks_title_size'),
      ('public.ai_employee_tasks', 'ai_employee_tasks_description_size')
    ) as v(rel, name)
  loop
    assert (select convalidated from pg_constraint where conname = c.name and conrelid = c.rel::regclass),
      format('%s must exist and be validated', c.name);
  end loop;
end $$;

-- The owner, through the Data API.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009001","role":"authenticated"}', true);
do $$
declare
  emp constant uuid := '00000000-0000-4000-8000-000000009003';
  conv constant uuid := '00000000-0000-4000-8000-000000009004';
  bytes integer;
begin
  -- Up to the bounds: accepted.
  insert into public.ai_employee_messages (conversation_id, role, content) values (conv, 'user', repeat('m', 16000));
  insert into public.ai_employee_tasks (employee_id, title, description, assignee)
    values (emp, repeat('t', 200), repeat('d', 2000), 'human');

  -- RE-6: what the API accepts for goals fits the bound — 3-byte characters, and control
  -- characters (escaped as \u00XX, 6 bytes each) for the worst case. (Literal characters, not
  -- chr(): the throwaway test cluster may use SQL_ASCII; byte counts are the same either way.)
  update public.ai_employees set goals = (select jsonb_agg(repeat('✓', 200)) from generate_series(1, 8)) where id = emp;
  select octet_length(goals::text) into bytes from public.ai_employees where id = emp;
  assert bytes = 4832, format('8 goals of 200 three-byte characters serialise to 4832 bytes (the old bound was 4096), got %s', bytes);
  update public.ai_employees set goals = (select jsonb_agg(repeat(chr(1), 200)) from generate_series(1, 8)) where id = emp;
  select octet_length(goals::text) into bytes from public.ai_employees where id = emp;
  assert bytes = 9632, format('8 goals of 200 escaped characters serialise to 9632 bytes, got %s', bytes);

  begin
    insert into public.ai_employee_messages (conversation_id, role, content) values (conv, 'user', repeat('m', 16001));
    raise exception 'a message over 16000 characters must be refused';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employee_messages set content = repeat('m', 400000) where conversation_id = conv;
    raise exception 'a message must not be grown past the bound';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_employee_tasks (employee_id, title) values (emp, repeat('t', 201));
    raise exception 'a task title over 200 characters must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.ai_employee_tasks (employee_id, title, description) values (emp, 'x', repeat('d', 2001));
    raise exception 'a task description over 2000 characters must be refused';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employee_tasks set description = repeat('d', 400000) where employee_id = emp;
    raise exception 'a task description must not be grown past the bound';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set goals = (select jsonb_agg(repeat('✓', 2100)) from generate_series(1, 8)) where id = emp;
    raise exception 'goals over 16384 bytes must be refused';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set goals = (select jsonb_agg(g::text) from generate_series(1, 9) g) where id = emp;
    raise exception 'at most 8 goals';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set goals = '{"not": "an array"}' where id = emp;
    raise exception 'goals must be an array';
  exception when check_violation then null;
  end;
end $$;
reset role;

rollback;
