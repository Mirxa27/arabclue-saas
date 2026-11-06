-- claim_voice_number_provisioning() reservation state machine (F35), exercised as the
-- service role so it also proves the role's grants are sufficient in opt-in mode.
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'e@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1', 'Store E');

set local role service_role;

do $$
declare
  m constant uuid := '00000000-0000-4000-8000-0000000000e2';
  r jsonb;
begin
  -- first request takes the reservation (and creates the config row to lock)
  r := public.claim_voice_number_provisioning(m);
  assert r ->> 'outcome' = 'claimed', format('first claim: %s', r);
  assert r ->> 'phone_number' is null, 'no number yet';
  assert (select provisioning_started_at from public.voice_configs where merchant_id = m) is not null, 'reservation must be recorded';

  -- a concurrent/repeated request must not buy a second number
  r := public.claim_voice_number_provisioning(m);
  assert r ->> 'outcome' = 'in_progress', format('second claim while reserved: %s', r);
  r := public.claim_voice_number_provisioning(m, true);
  assert r ->> 'outcome' = 'in_progress', format('replace while reserved: %s', r);

  -- the route records the purchased number and clears the reservation
  update public.voice_configs
     set phone_number = '+966500000900', twilio_incoming_sid = 'PN-E1', enabled = true, provisioning_started_at = null
   where merchant_id = m;
  insert into public.events (kind, merchant, payload) values ('voice.number_provisioned', m::text, '{"sid": "PN-E1"}');

  r := public.claim_voice_number_provisioning(m);
  assert r ->> 'outcome' = 'already_provisioned', format('existing number: %s', r);
  assert r ->> 'phone_number' = '+966500000900', 'already_provisioned returns the number';

  -- replace: reservation hands back the old sid so it can be released first
  r := public.claim_voice_number_provisioning(m, true);
  assert r ->> 'outcome' = 'claimed', format('replace claim: %s', r);
  assert r ->> 'twilio_incoming_sid' = 'PN-E1', 'replace claim returns the sid to release';

  -- a crashed request's reservation becomes claimable once stale
  update public.voice_configs set provisioning_started_at = now() - interval '1 hour' where merchant_id = m;
  r := public.claim_voice_number_provisioning(m, true, 600);
  assert r ->> 'outcome' = 'claimed', format('stale reservation: %s', r);

  -- durable daily cap on successful purchases
  update public.voice_configs set provisioning_started_at = null where merchant_id = m;
  insert into public.events (kind, merchant, payload) values
    ('voice.number_provisioned', m::text, '{}'),
    ('voice.number_provisioned', m::text, '{}');
  r := public.claim_voice_number_provisioning(m, true, 600, 3);
  assert r ->> 'outcome' = 'rate_limited', format('cap reached: %s', r);
  assert (select provisioning_started_at from public.voice_configs where merchant_id = m) is null, 'rate-limited claim must not reserve';
  -- purchases older than 24h no longer count
  update public.events set created_at = now() - interval '2 days' where merchant = m::text and kind = 'voice.number_provisioned';
  r := public.claim_voice_number_provisioning(m, true, 600, 3);
  assert r ->> 'outcome' = 'claimed', format('cap window: %s', r);
end $$;

reset role;
rollback;
