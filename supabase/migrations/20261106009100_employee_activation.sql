-- arabclue · AI employees: atomic, seat-limited activation (RE-3)
--
-- Resuming an employee (paused or offboarded → active) takes a seat of the plan. The API used to
-- count seats in one request and update the row in another, with nothing locked in between, so
-- concurrent resumes all passed the count and went over the plan's limit (SW-39 fixed the same
-- race for hiring only). activate_ai_employee() does both in one transaction under the same
-- per-merchant row lock as hire_ai_employee(), so resumes and hires are serialised against each
-- other. It also re-checks that the seat is paid (a running trial or a current paid period), so
-- a billing-cycle pause between the API's check and the switch cannot be overwritten.
--
-- Outcomes (jsonb {"outcome": ...}):
--   activated           the employee is active, with p_patch applied (returns "employee": the row);
--                       also when it already was active (concurrent resume of the same employee)
--   seat_limit          the merchant's other non-offboarded employees already fill p_limit seats
--                       (returns "count": how many)
--   seat_unpaid         no running trial and no current paid period (returns its billing fields)
--   employee_not_found  no such employee for this merchant
--   merchant_not_found  no such merchant
-- p_patch may set only the profile columns the owner edits (display_name, avatar, language, tone,
-- timezone, working_hours, knowledge, goals, config) — any other key is ignored, so status,
-- billing columns or merchant_id cannot be injected. Size bounds still apply (23514).
-- Service role only. Re-runnable: create or replace, revoke-then-grant.

create or replace function public.activate_ai_employee(
  p_merchant_id uuid,
  p_employee_id uuid,
  p_limit integer,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_emp public.ai_employees%rowtype;
  v_others integer;
begin
  if p_merchant_id is null or p_employee_id is null or jsonb_typeof(v_patch) <> 'object' then
    raise exception 'activate_ai_employee: p_merchant_id, p_employee_id and an object p_patch are required'
      using errcode = '22004';
  end if;

  -- The critical section hire_ai_employee() uses: seat counts and switches to a seated state
  -- are serialised per merchant.
  perform 1 from public.merchants where id = p_merchant_id for update;
  if not found then
    return jsonb_build_object('outcome', 'merchant_not_found');
  end if;

  select * into v_emp
    from public.ai_employees
   where id = p_employee_id and merchant_id = p_merchant_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'employee_not_found');
  end if;

  if v_emp.status <> 'active' then
    if not coalesce((v_emp.billing_status = 'trial' and v_emp.trial_ends_at > now())
                    or (v_emp.billing_status = 'active' and v_emp.next_billing_at > now()), false) then
      return jsonb_build_object('outcome', 'seat_unpaid', 'billing_status', v_emp.billing_status,
                                'trial_ends_at', v_emp.trial_ends_at, 'next_billing_at', v_emp.next_billing_at);
    end if;

    select count(*) into v_others
      from public.ai_employees
     where merchant_id = p_merchant_id
       and status <> 'offboarded'
       and id <> p_employee_id;
    if v_others + 1 > greatest(coalesce(p_limit, 0), 0) then
      return jsonb_build_object('outcome', 'seat_limit', 'count', v_others);
    end if;
  end if;

  update public.ai_employees e
     set status = 'active',
         paused_at = case when e.status = 'active' then e.paused_at else null end,
         offboarded_at = case when e.status = 'offboarded' then null else e.offboarded_at end,
         display_name = coalesce(v_patch ->> 'display_name', e.display_name),
         avatar = case when v_patch ? 'avatar' then v_patch ->> 'avatar' else e.avatar end,
         language = coalesce(v_patch ->> 'language', e.language),
         tone = coalesce(v_patch ->> 'tone', e.tone),
         timezone = coalesce(v_patch ->> 'timezone', e.timezone),
         working_hours = coalesce(nullif(v_patch -> 'working_hours', 'null'::jsonb), e.working_hours),
         knowledge = case when v_patch ? 'knowledge' then v_patch ->> 'knowledge' else e.knowledge end,
         goals = coalesce(nullif(v_patch -> 'goals', 'null'::jsonb), e.goals),
         config = coalesce(nullif(v_patch -> 'config', 'null'::jsonb), e.config)
   where e.id = p_employee_id
  returning e.* into v_emp;

  return jsonb_build_object('outcome', 'activated', 'employee', to_jsonb(v_emp));
end;
$$;

revoke execute on function public.activate_ai_employee(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.activate_ai_employee(uuid, uuid, integer, jsonb) to service_role;

notify pgrst, 'reload schema';
