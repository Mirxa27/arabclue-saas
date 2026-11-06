-- arabclue · AI employees: honest task queue, bounded prompt inputs, atomic hiring
--
-- SW-5  ai_employee_tasks gets an owner (`assignee`), a `kind` and a structured `payload`.
--       The 24/7 tick only works `assignee = 'agent'` tasks, and only marks one done after
--       a real action succeeded. Escalations, invoice drafts and actions a customer asked
--       for (approvals) belong to the merchant (`assignee = 'human'`) and stay open until
--       the merchant acts. Open tasks the model created before this migration were never
--       authorised by the merchant (many came from customer conversations): they are handed
--       to the merchant instead of being executed.
-- SW-20 ai_employees.config / knowledge / goals / display_name are size-bounded in the
--       database too: `authenticated` holds a column UPDATE grant on them, so a cap that
--       only lives in the API could be bypassed through the Data API. Rows that already
--       exceed a bound keep working (the constraint stays NOT VALID, with a WARNING); the
--       runtime clamps every field before it reaches a model anyway.
-- SW-39 hire_ai_employee(): count-and-insert under a per-merchant row lock, so concurrent
--       hires cannot exceed the plan's seat limit. Service role only.
--
-- Re-runnable: add column if not exists, constraints added/validated in guarded blocks,
-- create or replace function, revoke-then-grant.

-- ── SW-5: task ownership + structured actions ───────────────────────────────
alter table public.ai_employee_tasks
  add column if not exists assignee text not null default 'agent',
  add column if not exists kind text not null default 'task',
  add column if not exists payload jsonb,
  add column if not exists conversation_id uuid references public.ai_employee_conversations(id) on delete set null;

do $$
begin
  alter table public.ai_employee_tasks
    add constraint ai_employee_tasks_assignee_check check (assignee in ('agent', 'human'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employee_tasks
    add constraint ai_employee_tasks_kind_check
    check (kind in ('task', 'followup', 'escalation', 'invoice_draft', 'approval', 'onboarding'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employee_tasks
    add constraint ai_employee_tasks_payload_size
    check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384));
exception when duplicate_object then null;
end $$;

-- Backfill. Only rows written before this migration are touched: they still carry the
-- column defaults and no payload (the runtime writes a payload with the turn's origin on
-- every task it creates), so a re-run never re-assigns a task created afterwards.
-- Open model-created tasks were never approved by the merchant — hand them over.
update public.ai_employee_tasks
   set assignee = 'human',
       kind = case
                when title like 'Escalate to human:%' then 'escalation'
                when title like 'Issue ZATCA invoice%' then 'invoice_draft'
                when title like 'Follow up with %' then 'followup'
                else 'task'
              end
 where source = 'autonomous'
   and status in ('todo', 'in_progress', 'blocked')
   and assignee = 'agent'
   and kind = 'task'
   and payload is null;

-- "Onboarding: connect your first channel" is something only the merchant can do.
update public.ai_employee_tasks
   set assignee = 'human', kind = 'onboarding'
 where source = 'system'
   and title like 'Onboarding:%'
   and assignee = 'agent'
   and kind = 'task'
   and payload is null;

create index if not exists employee_tasks_agent_due_idx
  on public.ai_employee_tasks (employee_id, due_at)
  where assignee = 'agent' and status in ('todo', 'in_progress');

create index if not exists employee_tasks_conversation_idx
  on public.ai_employee_tasks (conversation_id, kind)
  where conversation_id is not null;

-- ── SW-20: bounded prompt inputs ─────────────────────────────────────────────
do $$
begin
  alter table public.ai_employees
    add constraint ai_employees_config_size
    check (config is null or (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 16384)) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employees
    add constraint ai_employees_knowledge_size
    check (knowledge is null or char_length(knowledge) <= 8000) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employees
    add constraint ai_employees_goals_size
    check (goals is null or (jsonb_typeof(goals) = 'array' and jsonb_array_length(goals) <= 8
                             and octet_length(goals::text) <= 4096)) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_employees
    add constraint ai_employees_display_name_size
    check (char_length(display_name) between 1 and 64) not valid;
exception when duplicate_object then null;
end $$;

-- Validate where the existing data allows it; otherwise keep enforcing new writes only.
do $$
declare
  c text;
begin
  foreach c in array array['ai_employees_config_size', 'ai_employees_knowledge_size',
                           'ai_employees_goals_size', 'ai_employees_display_name_size'] loop
    begin
      execute format('alter table public.ai_employees validate constraint %I', c);
    exception when check_violation then
      raise warning '% stays NOT VALID: existing ai_employees rows exceed the bound (new writes are still checked)', c;
    end;
  end loop;
end $$;

-- ── SW-39: atomic seat-limited hire ──────────────────────────────────────────
-- Outcomes (jsonb {"outcome": ...}):
--   hired               the row was inserted (returns "employee": the new row)
--   seat_limit          p_limit non-offboarded employees already exist (returns "count")
--   duplicate           the merchant already has this role under this display name
--   merchant_not_found  no such merchant
-- merchant_id always comes from p_merchant_id, never from p_row; only the listed columns
-- are taken from p_row (id, status timestamps, billing ids and the like cannot be injected).
create or replace function public.hire_ai_employee(p_merchant_id uuid, p_limit integer, p_row jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_in public.ai_employees%rowtype;
  v_row public.ai_employees%rowtype;
begin
  if p_merchant_id is null or p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'hire_ai_employee: p_merchant_id and an object p_row are required' using errcode = '22004';
  end if;

  -- Serialise hires per merchant: the count below and the insert are one critical section.
  perform 1 from public.merchants where id = p_merchant_id for update;
  if not found then
    return jsonb_build_object('outcome', 'merchant_not_found');
  end if;

  select count(*) into v_count
    from public.ai_employees
   where merchant_id = p_merchant_id
     and status <> 'offboarded';
  if v_count >= greatest(coalesce(p_limit, 0), 0) then
    return jsonb_build_object('outcome', 'seat_limit', 'count', v_count);
  end if;

  v_in := jsonb_populate_record(null::public.ai_employees, p_row);
  begin
    insert into public.ai_employees (
      merchant_id, role_id, display_name, avatar, language, tone, timezone, working_hours,
      knowledge, goals, hire_plan, monthly_charge_halalas, trial_ends_at, billing_status,
      config, status
    ) values (
      p_merchant_id, v_in.role_id, v_in.display_name, v_in.avatar,
      coalesce(v_in.language, 'ar'), coalesce(v_in.tone, 'professional'),
      coalesce(v_in.timezone, 'Asia/Riyadh'),
      coalesce(v_in.working_hours, '{"mode":"always","start":"00:00","end":"23:59","days":[0,1,2,3,4,5,6]}'::jsonb),
      v_in.knowledge, coalesce(v_in.goals, '[]'::jsonb), coalesce(v_in.hire_plan, 'starter'),
      coalesce(v_in.monthly_charge_halalas, 9900), v_in.trial_ends_at,
      coalesce(v_in.billing_status, 'trial'), coalesce(v_in.config, '{}'::jsonb),
      coalesce(v_in.status, 'active')
    )
    returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'duplicate');
  end;

  return jsonb_build_object('outcome', 'hired', 'employee', to_jsonb(v_row));
end;
$$;

revoke execute on function public.hire_ai_employee(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.hire_ai_employee(uuid, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
