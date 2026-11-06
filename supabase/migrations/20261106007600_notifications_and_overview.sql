-- arabclue · dashboard notifications read-state + overview stats (dashboard stream: UI-016, UI-011)
--
-- 1. merchant_notification_state: when the merchant last opened the notifications panel. Items
--    newer than last_seen_at are unread (the bell dot shows only then). mark_notifications_seen()
--    moves it forward only (greatest), never back. The owner reads/writes their own row through
--    RLS (security invoker), with column-scoped grants.
-- 2. dashboard_overview_stats(merchant, now): the overview KPIs computed in the database, so they
--    are exact (no 5-row caps, no PostgREST max-rows truncation of a sum). Security invoker: RLS
--    applies to every table it reads, so another merchant's id yields zeros, never their data.
--    Month-to-date is the calendar month in Asia/Riyadh. "Accepted" counts both ZATCA outcomes
--    (cleared standard invoices and reported simplified ones).
--
-- Re-runnable.

-- ── merchant_notification_state ─────────────────────────────────────────────
create table if not exists public.merchant_notification_state (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.merchant_notification_state enable row level security;

drop policy if exists "notification_state_select_own" on public.merchant_notification_state;
create policy "notification_state_select_own" on public.merchant_notification_state
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

drop policy if exists "notification_state_insert_own" on public.merchant_notification_state;
create policy "notification_state_insert_own" on public.merchant_notification_state
  for insert to authenticated
  with check (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

drop policy if exists "notification_state_update_own" on public.merchant_notification_state;
create policy "notification_state_update_own" on public.merchant_notification_state
  for update to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())))
  with check (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

revoke all on table public.merchant_notification_state from anon, authenticated;
grant select on table public.merchant_notification_state to authenticated;
grant insert (merchant_id, last_seen_at, updated_at) on public.merchant_notification_state to authenticated;
grant update (last_seen_at, updated_at) on public.merchant_notification_state to authenticated;
grant select, insert, update, delete on table public.merchant_notification_state to service_role;

-- The bell reads a merchant's recent escalation events (events is otherwise indexed by kind
-- only). Partial, so it stays small on a busy event log.
create index if not exists events_escalations_merchant_idx
  on public.events (merchant, created_at desc)
  where kind in ('social.escalation', 'voice.escalation', 'employee.escalation');

-- Marks everything up to p_up_to (default now, never later than now) as seen. Returns the
-- stored last_seen_at.
create or replace function public.mark_notifications_seen(
  p_merchant_id uuid,
  p_up_to timestamptz default null
) returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_at timestamptz := least(coalesce(p_up_to, now()), now());
  v_seen timestamptz;
begin
  if p_merchant_id is null then
    raise exception 'mark_notifications_seen: merchant is required' using errcode = '22004';
  end if;
  insert into public.merchant_notification_state as s (merchant_id, last_seen_at, updated_at)
  values (p_merchant_id, v_at, now())
  on conflict (merchant_id) do update
     set last_seen_at = greatest(s.last_seen_at, excluded.last_seen_at),
         updated_at = now()
  returning s.last_seen_at into v_seen;
  return v_seen;
end;
$$;

revoke execute on function public.mark_notifications_seen(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_notifications_seen(uuid, timestamptz) to authenticated, service_role;

-- ── dashboard_overview_stats ────────────────────────────────────────────────
create or replace function public.dashboard_overview_stats(
  p_merchant_id uuid,
  p_now timestamptz default now()
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (date_trunc('month', p_now at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') as month_start,
           p_now - interval '30 days' as since_30d
  ),
  inv as (
    select
      coalesce(sum(i.total) filter (where i.created_at >= b.month_start and i.status not in ('rejected', 'failed')), 0) as mtd_total,
      count(*) filter (where i.created_at >= b.month_start and i.status not in ('rejected', 'failed')) as mtd_count,
      count(*) as invoices_total,
      count(*) filter (where i.created_at >= b.since_30d) as invoices_30d,
      -- accepted by ZATCA: standard invoices are 'cleared', simplified ones 'reported' (ZATCA Phase 2)
      count(*) filter (where i.created_at >= b.since_30d and i.status in ('cleared', 'reported')) as accepted_30d,
      count(*) filter (where i.created_at >= b.since_30d and i.status in ('submitted', 'reported', 'cleared', 'rejected', 'failed')) as submitted_30d,
      count(*) filter (where i.created_at >= b.since_30d and i.status in ('rejected', 'failed')) as rejected_30d
    from public.invoices i
    cross join bounds b
    where i.merchant_id = p_merchant_id
  ),
  posts as (
    select
      count(*) filter (where p.status = 'scheduled') as scheduled,
      count(*) filter (where p.status = 'published' and p.published_at >= b.since_30d) as published_30d,
      count(*) filter (where p.status = 'failed' and p.scheduled_for >= b.since_30d) as failed_30d
    from public.social_posts p
    cross join bounds b
    where p.merchant_id = p_merchant_id
  ),
  bk as (
    select count(*) filter (where k.created_at >= b.since_30d) as bookings_30d
    from public.bookings k
    cross join bounds b
    where k.merchant_id = p_merchant_id
  ),
  ag as (
    select count(*) filter (where a.enabled) as agents_enabled
    from public.agent_settings a
    where a.merchant_id = p_merchant_id
  ),
  emp as (
    select count(*) filter (where e.status = 'active') as employees_active
    from public.ai_employees e
    where e.merchant_id = p_merchant_id
  )
  select jsonb_build_object(
    'month_start', b.month_start,
    'since_30d', b.since_30d,
    'mtd_total', inv.mtd_total,
    'mtd_count', inv.mtd_count,
    'invoices_total', inv.invoices_total,
    'invoices_30d', inv.invoices_30d,
    'accepted_30d', inv.accepted_30d,
    'submitted_30d', inv.submitted_30d,
    'rejected_30d', inv.rejected_30d,
    'posts_scheduled', posts.scheduled,
    'posts_published_30d', posts.published_30d,
    'posts_failed_30d', posts.failed_30d,
    'bookings_30d', bk.bookings_30d,
    'agents_enabled', ag.agents_enabled,
    'employees_active', emp.employees_active
  )
  from bounds b, inv, posts, bk, ag, emp;
$$;

revoke execute on function public.dashboard_overview_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_overview_stats(uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
