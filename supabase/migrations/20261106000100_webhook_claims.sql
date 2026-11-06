-- Two-phase webhook claims (processing -> done | failed) with stale re-claim.
--
-- Previously a claim row meant "processed": it was inserted before the handler
-- ran, so a handler failure turned every provider retry into a silent
-- "duplicate" and the event was lost. Rows that already exist were processed
-- under the old semantics, hence status default 'done'.

alter table public.webhook_events
  add column if not exists status text not null default 'done',
  add column if not exists claimed_at timestamptz not null default now(),
  add column if not exists attempts integer not null default 1,
  add column if not exists last_error text;

do $$ begin
  alter table public.webhook_events
    add constraint webhook_events_status_check check (status in ('processing', 'done', 'failed'));
exception when duplicate_object then null;
end $$;

create index if not exists webhook_events_processed_at_idx on public.webhook_events (processed_at);

-- Provider event ids are internal: service role only (no Data API access for anon/authenticated).
alter table public.webhook_events enable row level security;
revoke all on table public.webhook_events from anon, authenticated;
grant select, insert, update, delete on table public.webhook_events to service_role;
grant usage, select on sequence public.webhook_events_id_seq to service_role;

-- Atomically claim (provider, event_id).
--   'new'         first delivery — process it
--   'retry'       previous attempt failed, or a 'processing' claim went stale — process it
--   'duplicate'   already processed successfully — acknowledge without work
--   'in_progress' another worker holds a fresh claim — ask the provider to retry later
create or replace function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_payload_hash text default null,
  p_stale_seconds integer default 300
) returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.webhook_events (provider, event_id, payload_hash, status, claimed_at, attempts, processed_at)
  values (p_provider, p_event_id, p_payload_hash, 'processing', now(), 1, now())
  on conflict (provider, event_id) do nothing;
  if found then
    return 'new';
  end if;

  update public.webhook_events
     set status = 'processing',
         claimed_at = now(),
         attempts = attempts + 1,
         last_error = null
   where provider = p_provider
     and event_id = p_event_id
     and (status = 'failed'
          or (status = 'processing' and claimed_at < now() - make_interval(secs => greatest(p_stale_seconds, 1))));
  if found then
    return 'retry';
  end if;

  if exists (
    select 1 from public.webhook_events
     where provider = p_provider and event_id = p_event_id and status = 'done'
  ) then
    return 'duplicate';
  end if;
  return 'in_progress';
end;
$$;

revoke execute on function public.claim_webhook_event(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(text, text, text, integer) to service_role;

-- Retention: drop finished claims older than the providers' retry horizons.
create or replace function public.prune_webhook_events(p_older_than_days integer default 14)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.webhook_events
   where status in ('done', 'failed')
     and processed_at < now() - make_interval(days => greatest(p_older_than_days, 2));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.prune_webhook_events(integer) to service_role;
