-- 24/7 tick fairness (F23): the cron used to take the 50 oldest-hired active
-- employees every run, so employee #51 onward never ticked. Serve the least
-- recently ticked first (never-ticked first), then by hire date.
create index if not exists ai_employee_heartbeats_last_tick_idx on public.ai_employee_heartbeats (last_tick_at);

create or replace function public.next_employees_to_tick(p_limit integer default 50)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select e.id
    from public.ai_employees e
    left join public.ai_employee_heartbeats h on h.employee_id = e.id
   where e.status = 'active'
   order by h.last_tick_at asc nulls first, e.hired_at asc, e.id asc
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

revoke execute on function public.next_employees_to_tick(integer) from public, anon, authenticated;
grant execute on function public.next_employees_to_tick(integer) to service_role;

-- Record that a tick was attempted (also for failed ticks), so failures move to
-- the back of the queue instead of being retried ahead of everyone else.
create or replace function public.mark_employees_ticked(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.ai_employee_heartbeats (employee_id, last_tick_at)
  select unnest(p_ids), now()
  on conflict (employee_id) do update set last_tick_at = excluded.last_tick_at;
$$;

revoke execute on function public.mark_employees_ticked(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_employees_ticked(uuid[]) to service_role;
