-- After 20261106005000_employee_safety.sql (and later migrations) ran on top of the seed:
--  * open model-created tasks were handed to the merchant with their kind; closed and
--    merchant-written tasks untouched; the onboarding task belongs to the merchant;
--  * the oversized config did not abort the migration: its constraint stays NOT VALID (new
--    writes are still checked) while the other bounds are validated;
--  * a re-run changes nothing.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('00000000-0000-4000-8000-00000000f511'::uuid, 'human', 'escalation'),
      ('00000000-0000-4000-8000-00000000f512'::uuid, 'human', 'invoice_draft'),
      ('00000000-0000-4000-8000-00000000f513'::uuid, 'human', 'followup'),
      ('00000000-0000-4000-8000-00000000f514'::uuid, 'human', 'task'),
      ('00000000-0000-4000-8000-00000000f515'::uuid, 'agent', 'task'),
      ('00000000-0000-4000-8000-00000000f516'::uuid, 'agent', 'task'),
      ('00000000-0000-4000-8000-00000000f517'::uuid, 'human', 'onboarding')
    ) as v(id, assignee, kind)
  loop
    assert (select assignee from public.ai_employee_tasks where id = r.id) = r.assignee,
      format('task %s: assignee %s expected', r.id, r.assignee);
    assert (select kind from public.ai_employee_tasks where id = r.id) = r.kind,
      format('task %s: kind %s expected', r.id, r.kind);
  end loop;

  assert not (select convalidated from pg_constraint where conname = 'ai_employees_config_size'),
    'the config bound must stay NOT VALID while an oversized row exists';
  assert (select convalidated from pg_constraint where conname = 'ai_employees_knowledge_size'),
    'bounds the data satisfies are validated';
  assert (select count(*) from public.ai_employees where id = '00000000-0000-4000-8000-00000000f504') = 1,
    'the oversized row is kept (the runtime clamps it)';

  begin
    update public.ai_employees set config = jsonb_build_object('persona_background', repeat('y', 40000))
     where id = '00000000-0000-4000-8000-00000000f503';
    raise exception 'new oversized writes must be refused even while the constraint is NOT VALID';
  exception when check_violation then null;
  end;
end $$;

-- Re-running the migration must not re-assign anything (the agent tasks above stay agent).
\ir ../../migrations/20261106005000_employee_safety.sql

do $$
begin
  assert (select assignee from public.ai_employee_tasks where id = '00000000-0000-4000-8000-00000000f516') = 'agent',
    're-run must leave merchant tasks alone';
  assert (select count(*) from public.ai_employee_tasks where assignee = 'human') = 5, 're-run must not hand over more tasks';
end $$;
