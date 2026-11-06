-- arabclue · atomic Twilio number provisioning reservation (F35)
--
-- POST /api/voice/provision-number read voice_configs, then bought a number: two
-- concurrent (or repeated) requests both passed the "no number yet" check and both
-- bought a number on the platform's Twilio account, only one of which was recorded.
--
-- claim_voice_number_provisioning() takes a per-merchant reservation under a row lock
-- before anything is bought, and caps successful purchases per merchant per 24 hours
-- (durable: counted from the voice.number_provisioned events the route writes).
-- The route clears the reservation when it finishes or fails; a crashed request's
-- reservation becomes re-claimable after p_stale_seconds. Re-runnable.

alter table public.voice_configs
  add column if not exists provisioning_started_at timestamptz;

-- Outcomes (jsonb {"outcome": ...}):
--   claimed              reservation taken — the caller may buy (returns the current
--                        phone_number / twilio_incoming_sid so a replace can release it)
--   already_provisioned  a number exists and p_replace is false (returns phone_number)
--   in_progress          another request holds a fresh reservation
--   rate_limited         p_max_per_day numbers were already provisioned in the last 24h
create or replace function public.claim_voice_number_provisioning(
  p_merchant_id uuid,
  p_replace boolean default false,
  p_stale_seconds integer default 600,
  p_max_per_day integer default 3
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.voice_configs%rowtype;
  v_recent integer;
begin
  if p_merchant_id is null then
    raise exception 'claim_voice_number_provisioning: p_merchant_id is required' using errcode = '22004';
  end if;

  -- Make sure there is a row to lock, then serialise concurrent claims on it.
  insert into public.voice_configs (merchant_id) values (p_merchant_id)
    on conflict (merchant_id) do nothing;
  select * into v_row from public.voice_configs where merchant_id = p_merchant_id for update;

  if v_row.provisioning_started_at is not null
     and v_row.provisioning_started_at > now() - make_interval(secs => greatest(p_stale_seconds, 60)) then
    return jsonb_build_object('outcome', 'in_progress');
  end if;

  if v_row.phone_number is not null and not coalesce(p_replace, false) then
    return jsonb_build_object('outcome', 'already_provisioned', 'phone_number', v_row.phone_number);
  end if;

  select count(*) into v_recent
    from public.events
   where kind = 'voice.number_provisioned'
     and merchant = p_merchant_id::text
     and created_at > now() - interval '1 day';
  if v_recent >= greatest(coalesce(p_max_per_day, 3), 1) then
    return jsonb_build_object('outcome', 'rate_limited', 'provisioned_last_24h', v_recent);
  end if;

  update public.voice_configs
     set provisioning_started_at = now()
   where merchant_id = p_merchant_id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'phone_number', v_row.phone_number,
    'twilio_incoming_sid', v_row.twilio_incoming_sid
  );
end;
$$;

revoke execute on function public.claim_voice_number_provisioning(uuid, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_voice_number_provisioning(uuid, boolean, integer, integer) to service_role;

notify pgrst, 'reload schema';
