-- After 20261106009000_employee_bounds_repair.sql (and later migrations) ran on top of the seed:
--  * every bound is VALIDATED and every seeded row still exists, within its bounds;
--  * each repaired column has a note in public.events (sizes and md5, never the content);
--  * RE-5: the oversized rows can be paused by the billing cycle, activated after payment and
--    paused by the merchant again — the updates that failed with 23514 before;
--  * a re-run changes nothing and writes no further notes.
do $$
declare
  c record;
  e public.ai_employees%rowtype;
  n integer;
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
      format('%s must be validated after the repair', c.name);
  end loop;

  select count(*) into n from public.ai_employees where merchant_id = '00000000-0000-4000-8000-00000000f902';
  assert n = 5, format('every employee row is kept, got %s', n);

  -- config: only the API's persona keys, each within its API length
  select * into e from public.ai_employees where id = '00000000-0000-4000-8000-00000000f911';
  assert e.config = jsonb_build_object('persona_name', 'Layla', 'persona_age', 31, 'persona_gender', 'female',
                                       'persona_background', repeat('x', 500)),
    format('normalised config: %s', e.config);

  -- knowledge, goals, display name
  select * into e from public.ai_employees where id = '00000000-0000-4000-8000-00000000f912';
  assert e.knowledge = repeat('k', 8000), 'knowledge cut to 8000 characters';
  assert jsonb_array_length(e.goals) = 8 and e.goals ->> 0 = repeat('g', 200), format('goals: %s', left(e.goals::text, 80));
  assert e.display_name = repeat('N', 64), format('display name cut to 64: %s', e.display_name);
  select * into e from public.ai_employees where id = '00000000-0000-4000-8000-00000000f913';
  assert e.display_name = repeat('N', 25) || ' (00000000-0000-4000-8000-00000000f913)',
    format('a clashing repaired name gets the row id: %s', e.display_name);
  select * into e from public.ai_employees where id = '00000000-0000-4000-8000-00000000f914';
  assert e.display_name = 'موظف ذكي (AI employee)' and e.goals = '[]'::jsonb and e.config = '{}'::jsonb,
    format('wrong types reset, empty name filled: %s / %s / %s', e.display_name, e.goals, e.config);
  select * into e from public.ai_employees where id = '00000000-0000-4000-8000-00000000f915';
  assert e.display_name = 'Normal' and e.knowledge = 'Opening hours 9-5' and e.goals = '["reply fast"]'::jsonb
     and e.config = '{"persona_name": "Noura"}'::jsonb, 'a row within its bounds is untouched';

  -- messages and tasks
  assert (select char_length(content) from public.ai_employee_messages where id = '00000000-0000-4000-8000-00000000f931') = 16000,
    'oversized message cut to 16000 characters';
  assert (select content from public.ai_employee_messages where id = '00000000-0000-4000-8000-00000000f932') = 'Hello!',
    'a normal message is untouched';
  assert (select char_length(title) = 200 and char_length(description) = 2000
            from public.ai_employee_tasks where id = '00000000-0000-4000-8000-00000000f941'),
    'oversized task title / description cut to 200 / 2000';
  assert (select title = 'Prepare the weekly report' and description = 'Short'
            from public.ai_employee_tasks where id = '00000000-0000-4000-8000-00000000f942'),
    'a normal task is untouched';

  -- notes: one per repaired column, with sizes, never the content
  select count(*) into n from public.events where kind = 'employee.bounds_repaired';
  -- Bloated: config; 70×N: knowledge, goals, display_name; 80×N: display_name; '': display_name,
  -- goals, config; the message; the task's title and description.
  assert n = 11, format('11 repaired columns noted, got %s', n);
  assert (select count(*) from public.events
           where kind = 'employee.bounds_repaired' and merchant = '00000000-0000-4000-8000-00000000f902') = n,
    'notes are keyed by the merchant (PDPL export / erasure find them)';
  assert (select (payload -> 'before' ->> 'chars')::integer = 400000 and payload ->> 'md5' is null
                 and payload -> 'before' ->> 'md5' = md5(repeat('m', 400000))
            from public.events
           where kind = 'employee.bounds_repaired' and payload ->> 'row_id' = '00000000-0000-4000-8000-00000000f931'),
    'the message note records the old size and md5';
  assert (select payload ->> 'dropped_keys' = '["evil_prompt"]' and payload ->> 'action' = 'normalized'
            from public.events
           where kind = 'employee.bounds_repaired' and payload ->> 'column' = 'config'
             and payload ->> 'row_id' = '00000000-0000-4000-8000-00000000f911'),
    'the config note lists the dropped keys';
  assert not exists (select 1 from public.events
                      where kind = 'employee.bounds_repaired'
                        and (payload::text like '%xxxxxxxxxx%' or payload::text like '%mmmmmmmmmm%'
                             or payload::text like '%ignore all rules%')),
    'notes never carry the content';
end $$;

-- RE-5: the updates the oversized rows used to refuse with 23514, as the service role runs them.
set role service_role;
do $$
declare
  n integer;
begin
  -- enforceEmployeeBillingCycle: an ended trial …
  update public.ai_employees set billing_status = 'past_due', status = 'paused', paused_at = now()
   where id = '00000000-0000-4000-8000-00000000f911' and billing_status = 'trial' and trial_ends_at <= now();
  get diagnostics n = row_count;
  assert n = 1, 'the billing cycle pauses the employee whose trial ended';
  -- … and a lapsed paid period
  update public.ai_employees set billing_status = 'past_due', status = 'paused', paused_at = now()
   where id = '00000000-0000-4000-8000-00000000f912' and billing_status = 'active' and next_billing_at <= now();
  get diagnostics n = row_count;
  assert n = 1, 'the billing cycle pauses the employee whose paid period lapsed';

  -- confirmEmployeeBillingWithClient: the seat is paid, the employee runs again
  update public.ai_employees
     set billing_status = 'active', next_billing_at = now() + interval '30 days', status = 'active'
   where id = '00000000-0000-4000-8000-00000000f911' and merchant_id = '00000000-0000-4000-8000-00000000f902';
  get diagnostics n = row_count;
  assert n = 1, 'a paid seat activates';

  -- PATCH /api/employees/:id {status: 'paused'}
  update public.ai_employees set status = 'paused', paused_at = now()
   where id = '00000000-0000-4000-8000-00000000f911' and merchant_id = '00000000-0000-4000-8000-00000000f902';
  get diagnostics n = row_count;
  assert n = 1, 'the merchant pauses it';

  -- … and the RE-3 resume path
  assert public.activate_ai_employee('00000000-0000-4000-8000-00000000f902', '00000000-0000-4000-8000-00000000f911', 5) ->> 'outcome' = 'activated',
    'the merchant resumes it';

  -- the task the owner wrote oversized can be worked again
  update public.ai_employee_tasks set status = 'in_progress', started_at = now()
   where id = '00000000-0000-4000-8000-00000000f941';
  get diagnostics n = row_count;
  assert n = 1, 'the repaired task can be claimed by the tick';
end $$;
reset role;

-- A re-run finds nothing to repair.
\ir ../../migrations/20261106009000_employee_bounds_repair.sql

do $$
begin
  assert (select count(*) from public.events where kind = 'employee.bounds_repaired') = 11, 're-run must not write notes';
  assert (select display_name from public.ai_employees where id = '00000000-0000-4000-8000-00000000f913')
         = repeat('N', 25) || ' (00000000-0000-4000-8000-00000000f913)', 're-run must not rename again';
  assert (select convalidated from pg_constraint where conname = 'ai_employees_goals_size'), 're-run leaves the goals bound validated';
end $$;
