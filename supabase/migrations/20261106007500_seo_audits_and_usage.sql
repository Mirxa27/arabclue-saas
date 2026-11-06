-- arabclue · SEO site audits + per-merchant usage quotas (dashboard stream: F21/UI-004, SW-25, SW-26)
--
-- 1. merchant_usage_counters: one row per (merchant, metric, period) with how many units were
--    used. Service role only — the merchant can neither read nor reset it (deleting generated
--    seo_content rows must not give quota back). claim_merchant_usage() takes one unit
--    atomically (INSERT … ON CONFLICT DO UPDATE … WHERE used < limit: concurrent claims cannot
--    overshoot), release_merchant_usage() gives one back when the paid call failed.
--    Metrics: seo.generation (monthly, per plan), seo.audit (daily), wathq.lookup (daily).
-- 2. seo_site_audits: the results of POST /api/seo/audit (a real fetch of the merchant's store).
--    Written by the server only (service role); the owner may SELECT their own rows.
--
-- Re-runnable: if not exists / create or replace / drop policy if exists; grants are restated.

-- ── merchant_usage_counters ─────────────────────────────────────────────────
create table if not exists public.merchant_usage_counters (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  metric text not null,
  period_start date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (merchant_id, metric, period_start),
  constraint merchant_usage_counters_metric check (metric in ('seo.generation', 'seo.audit', 'wathq.lookup')),
  constraint merchant_usage_counters_used check (used >= 0)
);

alter table public.merchant_usage_counters enable row level security;
-- No policies: only the service role (BYPASSRLS) reads or writes counters.
revoke all on table public.merchant_usage_counters from anon, authenticated;
grant select, insert, update, delete on table public.merchant_usage_counters to service_role;

-- Outcome: {"allowed": bool, "used": int, "limit": int}
create or replace function public.claim_merchant_usage(
  p_merchant_id uuid,
  p_metric text,
  p_period_start date,
  p_limit integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_merchant_id is null or p_metric is null or p_period_start is null or p_limit is null then
    raise exception 'claim_merchant_usage: merchant, metric, period and limit are required' using errcode = '22004';
  end if;

  if p_limit <= 0 then
    select c.used into v_used
      from public.merchant_usage_counters c
     where c.merchant_id = p_merchant_id and c.metric = p_metric and c.period_start = p_period_start;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_used, 0), 'limit', p_limit);
  end if;

  insert into public.merchant_usage_counters as c (merchant_id, metric, period_start, used, updated_at)
  values (p_merchant_id, p_metric, p_period_start, 1, now())
  on conflict (merchant_id, metric, period_start) do update
     set used = c.used + 1,
         updated_at = now()
   where c.used < p_limit
  returning c.used into v_used;

  if v_used is null then
    -- the row exists and is at (or above) the limit: nothing was taken
    select c.used into v_used
      from public.merchant_usage_counters c
     where c.merchant_id = p_merchant_id and c.metric = p_metric and c.period_start = p_period_start;
    return jsonb_build_object('allowed', false, 'used', coalesce(v_used, p_limit), 'limit', p_limit);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', p_limit);
end;
$$;

-- Returns the units used after the release (null when there was nothing to give back).
create or replace function public.release_merchant_usage(
  p_merchant_id uuid,
  p_metric text,
  p_period_start date
) returns integer
language sql
security invoker
set search_path = public
as $$
  update public.merchant_usage_counters
     set used = used - 1,
         updated_at = now()
   where merchant_id = p_merchant_id
     and metric = p_metric
     and period_start = p_period_start
     and used > 0
  returning used;
$$;

revoke execute on function public.claim_merchant_usage(uuid, text, date, integer) from public, anon, authenticated;
grant execute on function public.claim_merchant_usage(uuid, text, date, integer) to service_role;
revoke execute on function public.release_merchant_usage(uuid, text, date) from public, anon, authenticated;
grant execute on function public.release_merchant_usage(uuid, text, date) to service_role;

-- ── seo_site_audits ─────────────────────────────────────────────────────────
create table if not exists public.seo_site_audits (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  url text not null,
  pages jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint seo_site_audits_url_length check (char_length(url) between 1 and 2048),
  constraint seo_site_audits_pages_array check (jsonb_typeof(pages) = 'array'),
  constraint seo_site_audits_issues_array check (jsonb_typeof(issues) = 'array'),
  constraint seo_site_audits_summary_object check (jsonb_typeof(summary) = 'object')
);

-- An audit is at most 4 pages × ~25 bilingual checks (well under 1 MB even with long URLs and
-- evidence); anything larger is not ours. Dropped and re-added so a re-run applies the bound.
alter table public.seo_site_audits drop constraint if exists seo_site_audits_size;
alter table public.seo_site_audits add constraint seo_site_audits_size
  check (pg_column_size(issues) + pg_column_size(pages) <= 1048576);

create index if not exists seo_site_audits_merchant_idx on public.seo_site_audits (merchant_id, created_at desc);

alter table public.seo_site_audits enable row level security;

drop policy if exists "seo_site_audits_select_own" on public.seo_site_audits;
create policy "seo_site_audits_select_own" on public.seo_site_audits
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

revoke all on table public.seo_site_audits from anon, authenticated;
grant select on table public.seo_site_audits to authenticated;
grant select, insert, update, delete on table public.seo_site_audits to service_role;

notify pgrst, 'reload schema';
