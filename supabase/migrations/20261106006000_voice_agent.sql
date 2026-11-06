-- arabclue · voice agent: server-gated on/off, bounded settings, call log, escalations,
-- durable Twilio number releases, retention (voice stream). Re-runnable.
--
-- SW-8   voice_configs.enabled is no longer writable through the Data API: a merchant could
--        PATCH /rest/v1/voice_configs {"enabled":true} on a plan without voice. The API
--        (lib/voice/config.ts) switches the agent on only after the plan, the platform kill
--        switch and the media bridge checks, and the call path re-checks all of them per call.
-- SW-40  dialect has no column default any more: NULL means "the platform default"
--        (platform_settings agents.voice.defaultDialect). 'english' joins the allowed values
--        because the admin can pick it as the default.
-- SW-41  bounded settings: knowledge <= 4000 chars, hours <= 200, escalation_phone E.164.
--        Existing rows are trimmed / normalised first so the constraints validate.
-- SW-22  voice_number_releases: service-only queue of Twilio numbers that must be released
--        (account deletion, plan lapse, Salla uninstall, a purchase that could not be
--        recorded). It has no merchant key, so erasing a merchant can never delete the only
--        record of a SID that Twilio still bills. voice_queue_number_release() moves a
--        merchant's number into it under the same row lock claim_voice_number_provisioning()
--        takes, and refuses while a purchase is in flight.
-- SW-23/24 voice_calls: one row per routed call with the caller's number as Twilio reported
--        it (order lookups only answer for orders placed with that number; escalations call
--        back on it). voice_escalations: hand-overs the merchant can see and resolve.
-- SW-45  prune_voice_records(): 30-day retention for voice.* events and voice_calls.

-- ── voice_configs ───────────────────────────────────────────────────────────────
alter table public.voice_configs alter column dialect drop default;

alter table public.voice_configs drop constraint if exists voice_configs_dialect_check;
alter table public.voice_configs add constraint voice_configs_dialect_check
  check (dialect is null or dialect in ('khaliji', 'msa', 'english'));

-- Set by the voice housekeeping (lib/voice/number-release.ts) when a merchant holding a number
-- loses the voice entitlement; the number is released after the grace period.
alter table public.voice_configs add column if not exists entitlement_lost_at timestamptz;

-- Bring existing settings inside the bounds before the constraints are (re)validated.
update public.voice_configs set knowledge = left(knowledge, 4000) where char_length(knowledge) > 4000;
update public.voice_configs set hours = left(hours, 200) where char_length(hours) > 200;

-- escalation_phone → E.164: Arabic-Indic digits, spaces and dashes are tolerated, Saudi local
-- forms (05…, 5…, 9665…, 009665…) are converted; anything else cannot be dialled → NULL.
with digits as (
  select merchant_id,
         regexp_replace(
           translate(escalation_phone, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
           '[^0-9+]', '', 'g') as d
    from public.voice_configs
   where escalation_phone is not null
), normalised as (
  select merchant_id,
         case
           when d ~ '^\+[1-9][0-9]{7,14}$' then d
           when d ~ '^00[1-9][0-9]{7,14}$' then '+' || substr(d, 3)
           when d ~ '^05[0-9]{8}$' then '+966' || substr(d, 2)
           when d ~ '^5[0-9]{8}$' then '+966' || d
           when d ~ '^9665[0-9]{8}$' then '+' || d
           else null
         end as phone
    from digits
)
update public.voice_configs v
   set escalation_phone = n.phone
  from normalised n
 where v.merchant_id = n.merchant_id
   and v.escalation_phone is distinct from n.phone;

alter table public.voice_configs drop constraint if exists voice_configs_knowledge_len;
alter table public.voice_configs add constraint voice_configs_knowledge_len
  check (knowledge is null or char_length(knowledge) <= 4000);
alter table public.voice_configs drop constraint if exists voice_configs_hours_len;
alter table public.voice_configs add constraint voice_configs_hours_len
  check (hours is null or char_length(hours) <= 200);
alter table public.voice_configs drop constraint if exists voice_configs_escalation_phone_e164;
alter table public.voice_configs add constraint voice_configs_escalation_phone_e164
  check (escalation_phone is null or escalation_phone ~ '^\+[1-9][0-9]{7,14}$');

-- SW-8: settings stay merchant-editable (bounded above); the on/off switch is server-only.
revoke insert (enabled), update (enabled) on public.voice_configs from authenticated;

-- ── voice_calls: the merchant's call log (and the verified caller for tool calls) ──
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  call_sid text not null,
  -- E.164 caller id exactly as Twilio reported it (From); NULL when withheld.
  caller_number text,
  -- bridged: connected to the AI agent · forwarded: no media bridge, sent to the store's
  -- escalation phone · not_bridged: no media bridge and no phone, caller told so ·
  -- declined: the agent may not answer (decline_reason)
  outcome text not null,
  decline_reason text,
  created_at timestamptz not null default now(),
  constraint voice_calls_call_sid_key unique (call_sid),
  constraint voice_calls_call_sid_len check (char_length(call_sid) between 2 and 64),
  constraint voice_calls_caller_e164 check (caller_number is null or caller_number ~ '^\+[1-9][0-9]{6,14}$'),
  constraint voice_calls_outcome_check check (outcome in ('bridged', 'forwarded', 'not_bridged', 'declined')),
  constraint voice_calls_decline_reason_check check (
    (outcome = 'declined') = (decline_reason is not null)
    and (decline_reason is null or decline_reason in ('agent_off', 'plan', 'platform_off'))
  )
);
create index if not exists voice_calls_merchant_created_idx on public.voice_calls (merchant_id, created_at desc);
create index if not exists voice_calls_created_idx on public.voice_calls (created_at);

alter table public.voice_calls enable row level security;
drop policy if exists "voice_calls_select_own" on public.voice_calls;
create policy "voice_calls_select_own" on public.voice_calls
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

revoke all on table public.voice_calls from anon, authenticated;
grant select on table public.voice_calls to authenticated;
grant select, insert, update, delete on table public.voice_calls to service_role;

-- ── voice_escalations: callers the store has to get back to ─────────────────────
create table if not exists public.voice_escalations (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  call_sid text,
  reason text not null,
  summary text,
  callback_number text,
  status text not null default 'open',
  -- outcome of the owner notification e-mail (lib/voice/requests.ts)
  notified text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint voice_escalations_reason_len check (char_length(reason) between 1 and 400),
  constraint voice_escalations_summary_len check (summary is null or char_length(summary) <= 1000),
  constraint voice_escalations_call_sid_len check (call_sid is null or char_length(call_sid) between 2 and 64),
  constraint voice_escalations_callback_e164 check (callback_number is null or callback_number ~ '^\+[1-9][0-9]{6,14}$'),
  constraint voice_escalations_status_check check (status in ('open', 'resolved')),
  constraint voice_escalations_notified_check check (
    notified is null or notified in ('email', 'not_configured', 'no_owner_email', 'failed', 'rate_limited'))
);
create index if not exists voice_escalations_merchant_idx on public.voice_escalations (merchant_id, status, created_at desc);

alter table public.voice_escalations enable row level security;
drop policy if exists "voice_escalations_select_own" on public.voice_escalations;
create policy "voice_escalations_select_own" on public.voice_escalations
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- Status changes go through PATCH /api/voice/escalations (service role, scoped to the session's merchant).
revoke all on table public.voice_escalations from anon, authenticated;
grant select on table public.voice_escalations to authenticated;
grant select, insert, update, delete on table public.voice_escalations to service_role;

-- ── voice_number_releases: Twilio numbers still to be released (service role only) ──
create table if not exists public.voice_number_releases (
  id uuid primary key default gen_random_uuid(),
  twilio_sid text not null,
  -- the platform-owned Twilio number (for the operator's console), not a customer's number
  phone_number text,
  reason text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  released_at timestamptz,
  constraint voice_number_releases_sid_key unique (twilio_sid),
  constraint voice_number_releases_sid_len check (char_length(twilio_sid) between 2 and 64),
  constraint voice_number_releases_reason_check check (
    reason in ('account_deleted', 'plan_lapsed', 'store_uninstalled', 'unrecorded_purchase')),
  constraint voice_number_releases_status_check check (status in ('pending', 'released')),
  constraint voice_number_releases_attempts_check check (attempts >= 0),
  constraint voice_number_releases_error_len check (last_error is null or char_length(last_error) <= 500)
);
create index if not exists voice_number_releases_due_idx
  on public.voice_number_releases (next_attempt_at) where status = 'pending';

alter table public.voice_number_releases enable row level security;
-- No policies: only the service role (BYPASSRLS) reads or writes the queue.
revoke all on table public.voice_number_releases from anon, authenticated;
grant select, insert, update, delete on table public.voice_number_releases to service_role;

-- ── voice_queue_number_release(): hand a merchant's number to the release queue ────
-- Outcomes (jsonb {"outcome": ...}):
--   queued       the number is in voice_number_releases (status pending) and no longer
--                routes calls to the merchant (phone_number / twilio_incoming_sid cleared)
--   in_progress  a purchase holds a fresh provisioning reservation — try again later
--   none         nothing to release (no config row, or no number)
create or replace function public.voice_queue_number_release(
  p_merchant_id uuid,
  p_reason text,
  p_stale_seconds integer default 600
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.voice_configs%rowtype;
  v_release_id uuid;
begin
  if p_merchant_id is null then
    raise exception 'voice_queue_number_release: p_merchant_id is required' using errcode = '22004';
  end if;
  if p_reason is null or p_reason not in ('account_deleted', 'plan_lapsed', 'store_uninstalled') then
    raise exception 'voice_queue_number_release: unknown reason %', p_reason using errcode = '22023';
  end if;

  -- Same row lock as claim_voice_number_provisioning(): a purchase cannot start in between.
  select * into v_row from public.voice_configs where merchant_id = p_merchant_id for update;
  if not found then
    return jsonb_build_object('outcome', 'none');
  end if;

  if v_row.provisioning_started_at is not null
     and v_row.provisioning_started_at > now() - make_interval(secs => greatest(p_stale_seconds, 60)) then
    return jsonb_build_object('outcome', 'in_progress');
  end if;

  if v_row.twilio_incoming_sid is null then
    if v_row.phone_number is not null then
      -- A routing number without a Twilio SID cannot be released by us; stop routing it.
      update public.voice_configs
         set phone_number = null, entitlement_lost_at = null, updated_at = now()
       where merchant_id = p_merchant_id;
    end if;
    return jsonb_build_object('outcome', 'none');
  end if;

  insert into public.voice_number_releases (twilio_sid, phone_number, reason)
  values (v_row.twilio_incoming_sid, v_row.phone_number, p_reason)
  on conflict (twilio_sid) do nothing;
  select id into v_release_id from public.voice_number_releases where twilio_sid = v_row.twilio_incoming_sid;

  update public.voice_configs
     set phone_number = null, twilio_incoming_sid = null, entitlement_lost_at = null, updated_at = now()
   where merchant_id = p_merchant_id;

  return jsonb_build_object(
    'outcome', 'queued',
    'release_id', v_release_id,
    'twilio_sid', v_row.twilio_incoming_sid,
    'phone_number', v_row.phone_number
  );
end;
$$;

revoke execute on function public.voice_queue_number_release(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.voice_queue_number_release(uuid, text, integer) to service_role;

-- ── prune_voice_records(): retention (employees-tick cron, lib/voice/housekeeping.ts) ──
-- voice.* events and the call log (callers' numbers) older than p_older_than_days, and
-- released queue entries older than 90 days. Bookings and escalations are the merchant's
-- records and are kept until the merchant deletes them or the account.
create or replace function public.prune_voice_records(p_older_than_days integer default 30)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_older_than_days, 30), 1));
  v_events integer;
  v_calls integer;
  v_releases integer;
begin
  delete from public.events
   where kind in ('voice.inbound_call', 'voice.tool_call', 'voice.escalation', 'voice.booking',
                  'voice.number_provisioned', 'voice.number_released')
     and created_at < v_cutoff;
  get diagnostics v_events = row_count;

  delete from public.voice_calls where created_at < v_cutoff;
  get diagnostics v_calls = row_count;

  delete from public.voice_number_releases
   where status = 'released' and released_at < now() - interval '90 days';
  get diagnostics v_releases = row_count;

  return jsonb_build_object('events', v_events, 'calls', v_calls, 'releases', v_releases);
end;
$$;

revoke execute on function public.prune_voice_records(integer) from public, anon, authenticated;
grant execute on function public.prune_voice_records(integer) to service_role;

notify pgrst, 'reload schema';
