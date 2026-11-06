-- Voice agent privileges (20261106006000_voice_agent.sql), in both DB_TEST_GRANTS modes:
--  * SW-8: voice_configs.enabled is server-only; the settings columns stay merchant-editable
--  * voice_calls / voice_escalations: owner may read (RLS), never write
--  * voice_number_releases: service role only (no merchant key, erasure-proof)
--  * the queue / prune functions are service-role RPCs
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['voice_calls', 'voice_escalations', 'voice_number_releases'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), format('RLS must be enabled on %s', t);
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert not has_table_privilege('anon', 'public.' || t, p), format('anon must not have %s on %s', p, t);
    end loop;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert not has_table_privilege('authenticated', 'public.' || t, p), format('authenticated must not have %s on %s', p, t);
    end loop;
    foreach p in array array['INSERT', 'UPDATE'] loop
      assert not has_any_column_privilege('authenticated', 'public.' || t, p), format('authenticated must not %s columns of %s', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('service_role', 'public.' || t, p), format('service_role needs %s on %s', p, t);
    end loop;
  end loop;

  assert has_table_privilege('authenticated', 'public.voice_calls', 'SELECT'), 'merchants read their call log';
  assert has_table_privilege('authenticated', 'public.voice_escalations', 'SELECT'), 'merchants read their hand-overs';
  assert not has_any_column_privilege('authenticated', 'public.voice_number_releases', 'SELECT'), 'the release queue is service-only';

  -- SW-8: the on/off switch is written by the gated API only
  assert not has_column_privilege('authenticated', 'public.voice_configs', 'enabled', 'INSERT'), 'voice_configs.enabled must not be insertable';
  assert not has_column_privilege('authenticated', 'public.voice_configs', 'enabled', 'UPDATE'), 'voice_configs.enabled must not be updatable';
  assert not has_column_privilege('authenticated', 'public.voice_configs', 'entitlement_lost_at', 'UPDATE'), 'entitlement_lost_at is server-only';
  assert has_column_privilege('authenticated', 'public.voice_configs', 'knowledge', 'UPDATE'), 'knowledge stays merchant-editable';
  assert has_column_privilege('authenticated', 'public.voice_configs', 'dialect', 'UPDATE'), 'dialect stays merchant-editable';

  foreach t in array array['public.voice_queue_number_release(uuid,text,integer)', 'public.prune_voice_records(integer)'] loop
    assert not has_function_privilege('anon', t, 'EXECUTE'), format('anon must not execute %s', t);
    assert not has_function_privilege('authenticated', t, 'EXECUTE'), format('authenticated must not execute %s', t);
    assert has_function_privilege('service_role', t, 'EXECUTE'), format('service_role must execute %s', t);
  end loop;
end $$;

-- The same, as a signed-in merchant through the Data API roles.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000070a1', 'voice-a@example.test'),
  ('00000000-0000-4000-8000-0000000070b1', 'voice-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-0000000070a2', '00000000-0000-4000-8000-0000000070a1', 'Voice A', 'lite', 'active'),
  ('00000000-0000-4000-8000-0000000070b2', '00000000-0000-4000-8000-0000000070b1', 'Voice B', 'plus', 'active');
insert into public.voice_configs (merchant_id, enabled) values
  ('00000000-0000-4000-8000-0000000070a2', false),
  ('00000000-0000-4000-8000-0000000070b2', true);
insert into public.voice_calls (merchant_id, call_sid, caller_number, outcome) values
  ('00000000-0000-4000-8000-0000000070a2', 'CA70a', '+966501110001', 'bridged'),
  ('00000000-0000-4000-8000-0000000070b2', 'CA70b', '+966501110002', 'bridged');
insert into public.voice_escalations (merchant_id, reason) values
  ('00000000-0000-4000-8000-0000000070a2', 'A complaint'),
  ('00000000-0000-4000-8000-0000000070b2', 'B complaint');
insert into public.voice_number_releases (twilio_sid, reason) values ('PN-70', 'account_deleted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000070a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
declare
  n integer;
  a constant uuid := '00000000-0000-4000-8000-0000000070a2';
begin
  select count(*) into n from public.voice_calls;
  assert n = 1, format('A must see only its own calls (saw %s)', n);
  assert (select caller_number from public.voice_calls) = '+966501110001', 'A reads its own call';
  select count(*) into n from public.voice_escalations;
  assert n = 1, format('A must see only its own hand-overs (saw %s)', n);

  begin
    perform 1 from public.voice_number_releases;
    raise exception 'voice_number_releases must not be readable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.voice_calls (merchant_id, call_sid, outcome) values (a, 'CA70forged', 'bridged');
    raise exception 'voice_calls must not be writable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    update public.voice_escalations set status = 'resolved';
    raise exception 'voice_escalations must not be writable by merchants (status goes through the API)';
  exception when insufficient_privilege then null; end;

  -- SW-8: a lite merchant cannot switch its voice agent on through the Data API
  begin
    update public.voice_configs set enabled = true where merchant_id = a;
    raise exception 'voice_configs.enabled must not be writable (plan gate bypass)';
  exception when insufficient_privilege then null; end;
  begin
    -- what a PostgREST upsert of {"enabled":true} runs
    insert into public.voice_configs (merchant_id, enabled) values (a, true)
      on conflict (merchant_id) do update set enabled = excluded.enabled;
    raise exception 'an upsert of enabled must be refused';
  exception when insufficient_privilege then null; end;

  update public.voice_configs set knowledge = 'returns within 7 days', dialect = 'english' where merchant_id = a;
  get diagnostics n = row_count;
  assert n = 1, 'A must still edit its voice settings';
  begin
    update public.voice_configs set knowledge = repeat('x', 4001) where merchant_id = a;
    raise exception 'knowledge over 4000 chars must be refused at the database';
  exception when check_violation then null; end;

  begin
    perform public.voice_queue_number_release(a, 'account_deleted');
    raise exception 'merchants must not call voice_queue_number_release';
  exception when insufficient_privilege then null; end;
  begin
    perform public.prune_voice_records(1);
    raise exception 'merchants must not call prune_voice_records';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
rollback;
