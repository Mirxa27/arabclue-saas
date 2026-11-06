-- arabclue · social publishing that is correct, gated, idempotent and honest.
--
--  SW-9   claim_due_social_posts: a post is published only by the run that claimed it
--         (FOR UPDATE SKIP LOCKED → status 'publishing' + claim_id). Every later write is
--         conditional on (id, claim_id, status = 'publishing'), so an overlapping cron run,
--         a duplicate Vercel delivery or the admin connection test can never publish twice
--         or overwrite another run's outcome.
--  SW-10  publish_results: one outcome per platform ({status, remoteId?, code?, message?, at}),
--         written as each platform finishes; 'sending' is written *before* the provider call so
--         a run that dies mid-publish leaves an honest "outcome unknown" instead of a re-post.
--  SW-11/SW-13  the claim joins the merchant's plan/subscription and their social agent switch
--         (agent_settings): paused or unentitled merchants' posts are never claimed, so they
--         cannot fill the batch. social_hold_unpublishable_posts fails unentitled merchants'
--         due posts (plan_required) and posts that missed their window (missed_window) instead
--         of publishing a backlog all at once.
--  SW-12  product_ids / media: the catalog images chosen at planning time (or by the merchant).
--  SW-27  social_channels refresh lease + token_invalid_at: X/TikTok refresh tokens are
--         single-use; one worker refreshes and stores the rotated pair with a compare-and-swap.
--  SW-31  social_plan_runs: one generation per merchant at a time + a daily quota.
--  SW-32  'draft' status: generated posts wait for the merchant's approval.
--
-- Re-runnable: add column if not exists, drop-then-add constraints, create or replace,
-- on conflict do nothing. Every new table/function carries explicit grants (opt-in Data API
-- grants since 2026-10-30).

-- ── social_posts ─────────────────────────────────────────────────────────────
alter table public.social_posts
  add column if not exists claim_id uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists publish_results jsonb not null default '{}'::jsonb,
  add column if not exists product_ids text[] not null default '{}'::text[],
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists error_code text,
  add column if not exists approved_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

update public.social_posts set status = 'draft' where status is null;

alter table public.social_posts drop constraint if exists social_posts_status_check;
alter table public.social_posts add constraint social_posts_status_check
  check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'canceled'));
-- Anything inserted without an explicit status waits for review instead of auto-publishing.
alter table public.social_posts alter column status set default 'draft';
alter table public.social_posts alter column status set not null;

alter table public.social_posts drop constraint if exists social_posts_publish_results_object;
alter table public.social_posts add constraint social_posts_publish_results_object
  check (jsonb_typeof(publish_results) = 'object');

alter table public.social_posts drop constraint if exists social_posts_media_array;
alter table public.social_posts add constraint social_posts_media_array
  check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 20);

-- A row can only be 'publishing' while a run holds it.
alter table public.social_posts drop constraint if exists social_posts_claim_consistent;
alter table public.social_posts add constraint social_posts_claim_consistent
  check (status <> 'publishing' or (claim_id is not null and claimed_at is not null));

create index if not exists social_posts_claimed_idx
  on public.social_posts (claimed_at) where status = 'publishing';
create index if not exists social_posts_merchant_schedule_idx
  on public.social_posts (merchant_id, scheduled_for);
-- social_posts_due_idx (scheduled_for) where status = 'scheduled' (0001) serves the claim.

-- ── claim_due_social_posts ───────────────────────────────────────────────────
-- Claims up to p_limit due posts of merchants whose plan + subscription include social
-- (p_plans / p_subscription_statuses come from lib/billing/entitlements.ts, the single
-- source of truth) and whose social agent is switched on. Rows another run holds are
-- skipped, never waited for. Posts later than p_max_lateness_seconds are left to
-- social_hold_unpublishable_posts.
create or replace function public.claim_due_social_posts(
  p_limit integer,
  p_plans text[],
  p_subscription_statuses text[],
  p_max_lateness_seconds integer
) returns setof public.social_posts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claim uuid := gen_random_uuid();
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_lateness interval := make_interval(secs => greatest(coalesce(p_max_lateness_seconds, 21600), 60));
begin
  return query
  with due as (
    select p.id
      from public.social_posts p
      join public.merchants m on m.id = p.merchant_id
      join public.agent_settings a on a.merchant_id = p.merchant_id and a.persona_role = 'social'
     where p.status = 'scheduled'
       and p.scheduled_for <= now()
       and p.scheduled_for > now() - v_lateness
       and coalesce(m.plan, 'lite') = any (p_plans)
       and coalesce(m.subscription_status, 'pending') = any (p_subscription_statuses)
       and a.enabled
       and a.status <> 'paused'
     order by p.scheduled_for, p.id
     limit v_limit
     for update of p skip locked
  )
  update public.social_posts s
     set status = 'publishing',
         claim_id = v_claim,
         claimed_at = now(),
         attempts = s.attempts + 1
    from due
   where s.id = due.id
  returning s.*;
end;
$$;

-- ── social_hold_unpublishable_posts ──────────────────────────────────────────
-- Due 'scheduled' posts that must not be published now:
--   plan_required  the merchant's plan/subscription no longer includes social (or never did:
--                  owners can insert social_posts directly through the Data API)
--   missed_window  more than p_max_lateness_seconds late (agent paused, scheduler down):
--                  never blasted out as a backlog; the merchant can re-queue them.
-- A paused agent's posts that are still inside the window are left alone.
create or replace function public.social_hold_unpublishable_posts(
  p_plans text[],
  p_subscription_statuses text[],
  p_max_lateness_seconds integer,
  p_limit integer
) returns table (held_post_id uuid, held_merchant_id uuid, held_reason text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_lateness_seconds integer := greatest(coalesce(p_max_lateness_seconds, 21600), 60);
  v_lateness interval := make_interval(secs => v_lateness_seconds);
  v_hours integer := greatest(1, round(v_lateness_seconds / 3600.0)::integer);
begin
  return query
  with blocked as (
    select p.id,
           case
             when not (coalesce(m.plan, 'lite') = any (p_plans)
                       and coalesce(m.subscription_status, 'pending') = any (p_subscription_statuses))
               then 'plan_required'
             else 'missed_window'
           end as why
      from public.social_posts p
      join public.merchants m on m.id = p.merchant_id
     where p.status = 'scheduled'
       and p.scheduled_for <= now()
       and (not (coalesce(m.plan, 'lite') = any (p_plans)
                 and coalesce(m.subscription_status, 'pending') = any (p_subscription_statuses))
            or p.scheduled_for <= now() - v_lateness)
     order by p.scheduled_for, p.id
     limit v_limit
     for update of p skip locked
  )
  update public.social_posts s
     set status = 'failed',
         error_code = b.why,
         error = case b.why
           when 'plan_required' then
             'Not published: social publishing needs an active subscription on a plan that includes the social module.'
           else
             format('Not published: its scheduled time passed more than %s hours ago (the social agent was paused or the scheduler was not running). Re-queue it to publish.', v_hours)
         end
    from blocked b
   where s.id = b.id
  returning s.id, s.merchant_id, b.why;
end;
$$;

-- ── social_channels: token refresh lease (SW-27) ─────────────────────────────
alter table public.social_channels
  add column if not exists refresh_lease uuid,
  add column if not exists refresh_lease_until timestamptz,
  add column if not exists token_invalid_at timestamptz,
  add column if not exists token_refreshed_at timestamptz;

-- Returns a lease id when the caller may refresh this channel's tokens now; null when another
-- worker holds a live lease, nothing is refreshable or the provider already rejected the grant.
-- The holder stores the rotated pair with `… where refresh_lease = <lease> and
-- refresh_token_encrypted = <old>` and clears the lease; a crashed holder's lease expires.
create or replace function public.social_claim_token_refresh(
  p_channel_id uuid,
  p_lease_seconds integer default 60
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lease uuid := gen_random_uuid();
begin
  update public.social_channels
     set refresh_lease = v_lease,
         refresh_lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 5), 300))
   where id = p_channel_id
     and refresh_token_encrypted is not null
     and token_invalid_at is null
     and (refresh_lease_until is null or refresh_lease_until < now());
  if found then
    return v_lease;
  end if;
  return null;
end;
$$;

-- A new access token (OAuth reconnect, pasted token, successful refresh) means the
-- "reconnect required" marker no longer applies — for every writer, not just ours.
create or replace function public.social_channels_token_changed()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.access_token_encrypted is distinct from old.access_token_encrypted
     and new.token_invalid_at is not distinct from old.token_invalid_at then
    new.token_invalid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists social_channels_token_changed on public.social_channels;
create trigger social_channels_token_changed
  before update on public.social_channels
  for each row execute function public.social_channels_token_changed();

-- ── social_plan_runs: single-flight + daily quota for POST /api/social/plan (SW-31) ──
create table if not exists public.social_plan_runs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  plan_id uuid references public.social_plans(id) on delete set null,
  post_count integer,
  llm_calls integer,
  error text
);

create unique index if not exists social_plan_runs_one_running_key
  on public.social_plan_runs (merchant_id) where status = 'running';
create index if not exists social_plan_runs_merchant_started_idx
  on public.social_plan_runs (merchant_id, started_at desc);

alter table public.social_plan_runs enable row level security;
-- No policies: service role only (the quota must not be resettable by the merchant).
revoke all on table public.social_plan_runs from anon, authenticated;
grant select, insert, update, delete on table public.social_plan_runs to service_role;

-- outcome: 'started' (run_id set) | 'busy' (a generation is running) | 'quota_exceeded'.
-- A run older than p_stale_seconds (the route's maxDuration has long passed) is closed as
-- failed first, so a crashed generation cannot lock the merchant out.
create or replace function public.social_begin_plan_run(
  p_merchant_id uuid,
  p_daily_quota integer,
  p_stale_seconds integer
) returns table (run_id uuid, outcome text, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quota integer := least(greatest(coalesce(p_daily_quota, 5), 1), 100);
  v_stale interval := make_interval(secs => greatest(coalesce(p_stale_seconds, 600), 60));
  v_count integer;
  v_oldest timestamptz;
  v_id uuid;
begin
  update public.social_plan_runs r
     set status = 'failed', finished_at = now(), error = coalesce(r.error, 'timed out')
   where r.merchant_id = p_merchant_id
     and r.status = 'running'
     and r.started_at < now() - v_stale;

  select count(*), min(r.started_at) into v_count, v_oldest
    from public.social_plan_runs r
   where r.merchant_id = p_merchant_id
     and r.started_at > now() - interval '24 hours';
  if v_count >= v_quota then
    return query select null::uuid, 'quota_exceeded'::text,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - now())))::integer);
    return;
  end if;

  begin
    insert into public.social_plan_runs (merchant_id) values (p_merchant_id) returning id into v_id;
  exception when unique_violation then
    return query select null::uuid, 'busy'::text, 30;
    return;
  end;
  return query select v_id, 'started'::text, null::integer;
end;
$$;

-- ── agent_settings backfill (SW-11) ──────────────────────────────────────────
-- Publishing and the inbound engager now require the merchant's social agent switch to be on.
-- agent_settings is new (20261106001200) and the pre-existing toggles never persisted, so
-- entitled merchants who already use social (a connected channel or queued posts) get the
-- state they had before: on. Merchants with a row keep their explicit choice.
insert into public.agent_settings (merchant_id, persona_role, enabled, status)
select m.id, 'social', true, 'active'
  from public.merchants m
 where coalesce(m.plan, 'lite') in ('plus', 'pro', 'enterprise')
   and coalesce(m.subscription_status, 'pending') in ('active', 'past_due')
   and (exists (select 1 from public.social_channels c where c.merchant_id = m.id)
        or exists (select 1 from public.social_posts p where p.merchant_id = m.id and p.status = 'scheduled'))
on conflict (merchant_id, persona_role) do nothing;

-- ── privileges ───────────────────────────────────────────────────────────────
revoke execute on function public.claim_due_social_posts(integer, text[], text[], integer) from public, anon, authenticated;
grant execute on function public.claim_due_social_posts(integer, text[], text[], integer) to service_role;

revoke execute on function public.social_hold_unpublishable_posts(text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function public.social_hold_unpublishable_posts(text[], text[], integer, integer) to service_role;

revoke execute on function public.social_claim_token_refresh(uuid, integer) from public, anon, authenticated;
grant execute on function public.social_claim_token_refresh(uuid, integer) to service_role;

revoke execute on function public.social_begin_plan_run(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.social_begin_plan_run(uuid, integer, integer) to service_role;

-- Trigger-only: triggers need no EXECUTE grant.
revoke execute on function public.social_channels_token_changed() from public, anon, authenticated;

notify pgrst, 'reload schema';
