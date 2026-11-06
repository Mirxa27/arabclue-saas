-- voice_configs bounds and defaults (SW-40, SW-41) and the voice_calls / voice_escalations
-- constraints, as the service role (what the API writes with).
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000071a1', 'voice-bounds@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000071a2', '00000000-0000-4000-8000-0000000071a1', 'Voice Bounds');

set local role service_role;

do $$
declare
  m constant uuid := '00000000-0000-4000-8000-0000000071a2';
begin
  -- SW-40: no column default — a new row speaks the platform default until the merchant chooses
  insert into public.voice_configs (merchant_id) values (m);
  assert (select dialect from public.voice_configs where merchant_id = m) is null, 'dialect must default to NULL (platform default)';
  assert (select enabled from public.voice_configs where merchant_id = m) = false, 'a new line is off';
  update public.voice_configs set dialect = 'english' where merchant_id = m;
  begin
    update public.voice_configs set dialect = 'klingon' where merchant_id = m;
    raise exception 'unknown dialect accepted';
  exception when check_violation then null; end;

  -- SW-41: bounded knowledge / hours, E.164 hand-over number
  update public.voice_configs set knowledge = repeat('k', 4000), hours = repeat('h', 200) where merchant_id = m;
  begin
    update public.voice_configs set knowledge = repeat('k', 4001) where merchant_id = m;
    raise exception 'knowledge over 4000 chars accepted';
  exception when check_violation then null; end;
  -- The bound counts characters, not bytes: 4000 Arabic letters fit. (Supabase databases are UTF8;
  -- the throwaway local cluster of scripts/db-test.sh is SQL_ASCII, where char_length counts bytes.)
  if (select pg_encoding_to_char(encoding) from pg_database where datname = current_database()) = 'UTF8' then
    update public.voice_configs set knowledge = repeat('ع', 4000) where merchant_id = m;
  end if;
  begin
    update public.voice_configs set hours = repeat('h', 201) where merchant_id = m;
    raise exception 'hours over 200 chars accepted';
  exception when check_violation then null; end;
  update public.voice_configs set escalation_phone = '+966551110000' where merchant_id = m;
  begin
    update public.voice_configs set escalation_phone = '0551110000' where merchant_id = m;
    raise exception 'a non-E.164 hand-over number accepted';
  exception when check_violation then null; end;

  -- voice_calls: one row per CallSid, E.164 or NULL caller, declined calls carry a reason
  insert into public.voice_calls (merchant_id, call_sid, caller_number, outcome) values (m, 'CA71a', '+966501112222', 'bridged');
  insert into public.voice_calls (merchant_id, call_sid, caller_number, outcome, decline_reason) values (m, 'CA71b', null, 'declined', 'plan');
  begin
    insert into public.voice_calls (merchant_id, call_sid, outcome) values (m, 'CA71a', 'bridged');
    raise exception 'a second row for the same CallSid accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.voice_calls (merchant_id, call_sid, caller_number, outcome) values (m, 'CA71c', 'anonymous', 'bridged');
    raise exception 'a non-E.164 caller accepted';
  exception when check_violation then null; end;
  begin
    insert into public.voice_calls (merchant_id, call_sid, outcome) values (m, 'CA71d', 'declined');
    raise exception 'a declined call without a reason accepted';
  exception when check_violation then null; end;
  begin
    insert into public.voice_calls (merchant_id, call_sid, outcome, decline_reason) values (m, 'CA71e', 'bridged', 'plan');
    raise exception 'a decline reason on a bridged call accepted';
  exception when check_violation then null; end;

  -- voice_escalations: bounded text, E.164 callback, known statuses
  insert into public.voice_escalations (merchant_id, call_sid, reason, summary, callback_number)
  values (m, 'CA71a', 'شكوى', 'تأخر الطلب', '+966501112222');
  assert (select status from public.voice_escalations where merchant_id = m) = 'open', 'a hand-over starts open';
  begin
    insert into public.voice_escalations (merchant_id, reason) values (m, repeat('x', 401));
    raise exception 'an oversized reason accepted';
  exception when check_violation then null; end;
  begin
    insert into public.voice_escalations (merchant_id, reason) values (m, '');
    raise exception 'an empty reason accepted';
  exception when check_violation then null; end;
  begin
    update public.voice_escalations set status = 'escalated' where merchant_id = m;
    raise exception 'an unknown status accepted';
  exception when check_violation then null; end;
  begin
    update public.voice_escalations set notified = 'pigeon' where merchant_id = m;
    raise exception 'an unknown notification outcome accepted';
  exception when check_violation then null; end;

  -- erasure: the merchant's call log and hand-overs go with the account
  delete from public.merchants where id = m;
  assert not exists (select 1 from public.voice_calls where merchant_id = m), 'voice_calls must cascade with the merchant';
  assert not exists (select 1 from public.voice_escalations where merchant_id = m), 'voice_escalations must cascade with the merchant';
end $$;

reset role;
rollback;
