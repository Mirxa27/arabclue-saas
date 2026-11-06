-- SW-20: prompt inputs on ai_employees are bounded in the database too (authenticated holds a
-- column UPDATE grant on config / knowledge / goals / display_name, so an API-only cap could be
-- bypassed through the Data API).
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000006c1', 'bounds@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000006c2', '00000000-0000-4000-8000-0000000006c1', 'Bounds Store');
insert into public.ai_employees (id, merchant_id, role_id, display_name) values
  ('00000000-0000-4000-8000-0000000006c3', '00000000-0000-4000-8000-0000000006c2', 'sales-rep', 'Layla');

do $$
declare
  c text;
begin
  foreach c in array array['ai_employees_config_size', 'ai_employees_knowledge_size', 'ai_employees_goals_size',
                           'ai_employees_display_name_size'] loop
    assert (select convalidated from pg_constraint where conname = c and conrelid = 'public.ai_employees'::regclass),
      format('%s must exist and be validated on clean data', c);
  end loop;
end $$;

-- The owner, through the Data API.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000006c1","role":"authenticated"}', true);
do $$
begin
  update public.ai_employees set config = '{"persona_name":"Layla"}', knowledge = 'Opening hours 9-5', goals = '["reply fast"]'
   where id = '00000000-0000-4000-8000-0000000006c3';

  begin
    update public.ai_employees set config = jsonb_build_object('persona_background', repeat('x', 3000000))
     where id = '00000000-0000-4000-8000-0000000006c3';
    raise exception 'a multi-megabyte config must be refused';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set config = '"not an object"' where id = '00000000-0000-4000-8000-0000000006c3';
    raise exception 'config must be an object';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set knowledge = repeat('k', 8001) where id = '00000000-0000-4000-8000-0000000006c3';
    raise exception 'knowledge must be at most 8000 characters';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set goals = (select jsonb_agg(g) from generate_series(1, 9) g)
     where id = '00000000-0000-4000-8000-0000000006c3';
    raise exception 'at most 8 goals';
  exception when check_violation then null;
  end;
  begin
    update public.ai_employees set display_name = repeat('n', 65) where id = '00000000-0000-4000-8000-0000000006c3';
    raise exception 'display_name must be at most 64 characters';
  exception when check_violation then null;
  end;
end $$;
reset role;

do $$
begin
  assert (select config ->> 'persona_name' from public.ai_employees where id = '00000000-0000-4000-8000-0000000006c3') = 'Layla',
    'a bounded config is stored';
end $$;

rollback;
