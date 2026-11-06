-- Admin overview plan mix (#37): exact counts grouped in SQL. The previous code
-- fetched `select plan from merchants` and counted in JS, which PostgREST caps at
-- max-rows (1000 on Supabase) and which counted unpaid signups as 'lite'.
create or replace function public.admin_plan_mix()
returns table (plan text, subscription_status text, merchants bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(m.plan, 'lite'), coalesce(m.subscription_status, 'pending'), count(*)
    from public.merchants m
   group by 1, 2
   order by 1, 2;
$$;

revoke execute on function public.admin_plan_mix() from public, anon, authenticated;
grant execute on function public.admin_plan_mix() to service_role;
