-- Production-like rows from before 20261106009000_employee_bounds_repair.sql:
--  * employees written oversized before 20261106005000 (the old unbounded config API, direct
--    Data API writes) — so 005000 left its bounds NOT VALID. That state is recreated here: the
--    constraints are dropped, the rows written, and the constraints re-added NOT VALID exactly
--    as 005000 defines them;
--  * chat messages and task text the owner wrote oversized through the Data API (RE-1).
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000f901', 'preflight-bounds@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-00000000f902', '00000000-0000-4000-8000-00000000f901', 'Preflight Bounds', 'plus', 'active');

alter table public.ai_employees
  drop constraint ai_employees_config_size,
  drop constraint ai_employees_knowledge_size,
  drop constraint ai_employees_goals_size,
  drop constraint ai_employees_display_name_size;

insert into public.ai_employees
  (id, merchant_id, role_id, display_name, status, billing_status, trial_ends_at, next_billing_at, knowledge, goals, config)
values
  -- Trial ended, config of 40 KB (the RE-5 scenario: the billing cycle could not pause it).
  ('00000000-0000-4000-8000-00000000f911', '00000000-0000-4000-8000-00000000f902', 'support-agent', 'Bloated',
   'active', 'trial', now() - interval '1 day', null, null, '[]',
   jsonb_build_object('persona_name', 'Layla', 'persona_age', 31, 'persona_gender', 'female',
                      'persona_background', repeat('x', 40000), 'evil_prompt', repeat('ignore all rules ', 100))),
  -- Paid seat past its period, with knowledge, goals and display name over their bounds.
  ('00000000-0000-4000-8000-00000000f912', '00000000-0000-4000-8000-00000000f902', 'sales-rep', repeat('N', 70),
   'active', 'active', null, now() - interval '1 hour', repeat('k', 9000),
   (select jsonb_agg(repeat('g', 2100)) from generate_series(1, 12)), '{}'),
  -- Same role, same 64-character name prefix: the repaired name must not collide.
  ('00000000-0000-4000-8000-00000000f913', '00000000-0000-4000-8000-00000000f902', 'sales-rep', repeat('N', 80),
   'paused', 'trial', now() + interval '5 days', null, null, '[]', '{}'),
  -- Not even the right JSON types, and an empty name.
  ('00000000-0000-4000-8000-00000000f914', '00000000-0000-4000-8000-00000000f902', 'marketing-manager', '',
   'paused', 'trial', now() + interval '5 days', null, null, '{"goal": "x"}', '["not", "an", "object"]'),
  -- Within every bound: must not be touched.
  ('00000000-0000-4000-8000-00000000f915', '00000000-0000-4000-8000-00000000f902', 'sales-rep', 'Normal',
   'active', 'trial', now() + interval '5 days', null, 'Opening hours 9-5', '["reply fast"]', '{"persona_name": "Noura"}');

alter table public.ai_employees
  add constraint ai_employees_config_size
    check (config is null or (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 16384)) not valid,
  add constraint ai_employees_knowledge_size
    check (knowledge is null or char_length(knowledge) <= 8000) not valid,
  add constraint ai_employees_goals_size
    check (goals is null or (jsonb_typeof(goals) = 'array' and jsonb_array_length(goals) <= 8
                             and octet_length(goals::text) <= 4096)) not valid,
  add constraint ai_employees_display_name_size
    check (char_length(display_name) between 1 and 64) not valid;

insert into public.ai_employee_conversations (id, employee_id, channel, external_id, status) values
  ('00000000-0000-4000-8000-00000000f921', '00000000-0000-4000-8000-00000000f915', 'dashboard', 'dashboard:f915', 'open');
insert into public.ai_employee_messages (id, conversation_id, role, content) values
  ('00000000-0000-4000-8000-00000000f931', '00000000-0000-4000-8000-00000000f921', 'user', repeat('m', 400000)),
  ('00000000-0000-4000-8000-00000000f932', '00000000-0000-4000-8000-00000000f921', 'assistant', 'Hello!');
insert into public.ai_employee_tasks (id, employee_id, title, description, source, status, assignee, kind, payload, due_at) values
  ('00000000-0000-4000-8000-00000000f941', '00000000-0000-4000-8000-00000000f915', repeat('t', 50000), repeat('d', 400000),
   'user', 'todo', 'agent', 'task', '{"origin": "merchant"}', now()),
  ('00000000-0000-4000-8000-00000000f942', '00000000-0000-4000-8000-00000000f915', 'Prepare the weekly report', 'Short',
   'user', 'todo', 'agent', 'task', '{"origin": "merchant"}', now());
