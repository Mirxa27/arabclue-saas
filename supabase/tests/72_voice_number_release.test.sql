-- voice_queue_number_release() and prune_voice_records() (SW-22, SW-45), exercised as the
-- service role so the role's grants are proven sufficient in opt-in mode too.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000072a1', 'release-a@example.test'),
  ('00000000-0000-4000-8000-0000000072b1', 'release-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000072a2', '00000000-0000-4000-8000-0000000072a1', 'Release A'),
  ('00000000-0000-4000-8000-0000000072b2', '00000000-0000-4000-8000-0000000072b1', 'Release B');

set local role service_role;

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000072a2';
  b constant uuid := '00000000-0000-4000-8000-0000000072b2';
  r jsonb;
begin
  -- nothing to release
  r := public.voice_queue_number_release(a, 'account_deleted');
  assert r ->> 'outcome' = 'none', format('no config row: %s', r);
  insert into public.voice_configs (merchant_id) values (a);
  r := public.voice_queue_number_release(a, 'account_deleted');
  assert r ->> 'outcome' = 'none', format('no number: %s', r);

  -- a purchase in flight holds the reservation: refuse (it would finish after the rows are gone)
  update public.voice_configs set provisioning_started_at = now() where merchant_id = a;
  r := public.voice_queue_number_release(a, 'account_deleted', 600);
  assert r ->> 'outcome' = 'in_progress', format('fresh reservation: %s', r);

  -- a provisioned number (stale reservation): queued, and no longer routes calls
  update public.voice_configs
     set provisioning_started_at = now() - interval '1 hour', phone_number = '+966112345672',
         twilio_incoming_sid = 'PN-72A', enabled = true, entitlement_lost_at = now() - interval '8 days'
   where merchant_id = a;
  r := public.voice_queue_number_release(a, 'plan_lapsed', 600);
  assert r ->> 'outcome' = 'queued', format('queue: %s', r);
  assert r ->> 'twilio_sid' = 'PN-72A', 'the SID to release is returned';
  assert (r ->> 'release_id') is not null, 'the queue row id is returned';
  assert (select phone_number from public.voice_configs where merchant_id = a) is null, 'the number must stop routing calls';
  assert (select twilio_incoming_sid from public.voice_configs where merchant_id = a) is null, 'the SID moved to the queue';
  assert (select entitlement_lost_at from public.voice_configs where merchant_id = a) is null, 'the lapse countdown is done';
  assert (select enabled from public.voice_configs where merchant_id = a), 'the merchant''s own switch is left as it was';
  assert exists (
    select 1 from public.voice_number_releases
     where twilio_sid = 'PN-72A' and status = 'pending' and reason = 'plan_lapsed' and phone_number = '+966112345672'
  ), 'the queue row must be pending';

  -- once moved, a repeat is a no-op (no second queue row)
  r := public.voice_queue_number_release(a, 'plan_lapsed');
  assert r ->> 'outcome' = 'none', format('repeat: %s', r);
  assert (select count(*) from public.voice_number_releases where twilio_sid = 'PN-72A') = 1, 'one queue row per SID';

  -- a fresh purchase after the release starts from "no number"
  r := public.claim_voice_number_provisioning(a);
  assert r ->> 'outcome' = 'claimed', format('claim after release: %s', r);
  update public.voice_configs set provisioning_started_at = null where merchant_id = a;

  begin
    perform public.voice_queue_number_release(a, 'because');
    raise exception 'an unknown reason must be refused';
  exception when invalid_parameter_value then null; end;

  -- account deletion: the queue row survives the erasure (no merchant key)
  insert into public.voice_configs (merchant_id, phone_number, twilio_incoming_sid, enabled) values (b, '+966112345673', 'PN-72B', true);
  r := public.voice_queue_number_release(b, 'account_deleted');
  assert r ->> 'outcome' = 'queued', format('erasure queue: %s', r);
  delete from public.merchants where id = b;
  assert not exists (select 1 from public.voice_configs where merchant_id = b), 'the config row cascaded away';
  assert exists (select 1 from public.voice_number_releases where twilio_sid = 'PN-72B' and reason = 'account_deleted'),
    'the SID must survive the account deletion until Twilio confirms the release';

  -- SW-45 retention: voice.* events and calls older than the window; nothing else
  insert into public.events (kind, merchant, payload, created_at) values
    ('voice.inbound_call', a::text, '{}', now() - interval '31 days'),
    ('voice.tool_call', a::text, '{}', now() - interval '31 days'),
    ('voice.tool_call', a::text, '{}', now() - interval '1 day'),
    ('order.created', a::text, '{}', now() - interval '400 days');
  insert into public.voice_calls (merchant_id, call_sid, outcome, created_at) values
    (a, 'CA72old', 'bridged', now() - interval '31 days'),
    (a, 'CA72new', 'bridged', now());
  update public.voice_number_releases set status = 'released', released_at = now() - interval '100 days' where twilio_sid = 'PN-72A';

  r := public.prune_voice_records(30);
  assert (r ->> 'events')::integer = 2, format('pruned events: %s', r);
  assert (r ->> 'calls')::integer = 1, format('pruned calls: %s', r);
  assert (r ->> 'releases')::integer = 1, format('pruned releases: %s', r);
  assert exists (select 1 from public.events where kind = 'order.created' and merchant = a::text), 'non-voice events are kept';
  assert exists (select 1 from public.events where kind = 'voice.tool_call' and merchant = a::text), 'recent voice events are kept';
  assert exists (select 1 from public.voice_calls where call_sid = 'CA72new'), 'recent calls are kept';
  assert exists (select 1 from public.voice_number_releases where twilio_sid = 'PN-72B'), 'pending releases are never pruned';
end $$;

reset role;
rollback;
