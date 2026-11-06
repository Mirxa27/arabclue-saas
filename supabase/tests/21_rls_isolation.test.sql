-- RLS + grants behaviour as real Data API roles (critic-13, F01): what a signed-in
-- merchant can and cannot do with the public anon key plus their own JWT.
-- Fixtures are created by the migration owner and rolled back at the end.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@example.test');

insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status, salla_merchant_id) values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Store A', 'lite', 'pending', null),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'Store B', 'pro', 'active', '777');

insert into public.invoices (merchant_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml) values
  ('00000000-0000-4000-8000-0000000000a2', 'INV-A-1', gen_random_uuid(), 1, 'hash-a', 'qr', '<xml/>'),
  ('00000000-0000-4000-8000-0000000000b2', 'INV-B-1', gen_random_uuid(), 1, 'hash-b', 'qr', '<xml/>');

insert into public.billing_payments (merchant_id, given_id, plan, amount_halalas) values
  ('00000000-0000-4000-8000-0000000000a2', gen_random_uuid(), 'pro', 59900),
  ('00000000-0000-4000-8000-0000000000b2', gen_random_uuid(), 'pro', 59900);

insert into public.ai_employees (id, merchant_id, role_id, display_name) values
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a2', 'sales-rep', 'Layla'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b2', 'sales-rep', 'Omar');

-- B has a provisioned number; A has a config without one.
insert into public.voice_configs (merchant_id, phone_number, twilio_incoming_sid) values
  ('00000000-0000-4000-8000-0000000000a2', null, null),
  ('00000000-0000-4000-8000-0000000000b2', '+966500000002', 'PN-B');

insert into public.social_channels (merchant_id, platform, external_id) values
  ('00000000-0000-4000-8000-0000000000a2', 'instagram', 'ig-a'),
  ('00000000-0000-4000-8000-0000000000b2', 'instagram', 'ig-b');

insert into public.brand_kits (merchant_id, brand_name) values
  ('00000000-0000-4000-8000-0000000000a2', 'Brand A'),
  ('00000000-0000-4000-8000-0000000000b2', 'Brand B');

insert into public.agent_settings (merchant_id, persona_role, enabled, status) values
  ('00000000-0000-4000-8000-0000000000a2', 'social', true, 'active'),
  ('00000000-0000-4000-8000-0000000000b2', 'social', true, 'active');

insert into public.support_tickets (user_id, merchant_id, category, message) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'help', 'Ticket from A'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'bug', 'Ticket from B');

insert into public.user_feedback (user_id, merchant_id, sentiment) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'up'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'down');

insert into public.events (kind, merchant, payload) values
  ('voice.inbound_call', '00000000-0000-4000-8000-0000000000a2', '{"from": "+966511111111"}');
insert into public.wathq_cache (cr_number, payload) values ('1010101010', '{"crEntityName": "real"}');

-- ── signed in as merchant A ──────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
declare
  n integer;
begin
  -- isolation: A sees exactly its own rows everywhere
  select count(*) into n from public.merchants;         assert n = 1, format('merchants visible to A: %s', n);
  select count(*) into n from public.invoices;          assert n = 1, format('invoices visible to A: %s', n);
  select count(*) into n from public.billing_payments;  assert n = 1, format('billing_payments visible to A: %s', n);
  select count(*) into n from public.ai_employees;      assert n = 1, format('ai_employees visible to A: %s', n);
  select count(*) into n from public.voice_configs;     assert n = 1, format('voice_configs visible to A: %s', n);
  select count(*) into n from public.social_channels;   assert n = 1, format('social_channels visible to A: %s', n);
  select count(*) into n from public.brand_kits;        assert n = 1, format('brand_kits visible to A: %s', n);
  select count(*) into n from public.agent_settings;    assert n = 1, format('agent_settings visible to A: %s', n);
  select count(*) into n from public.support_tickets;   assert n = 1, format('support_tickets visible to A: %s', n);
  select count(*) into n from public.user_feedback;     assert n = 1, format('user_feedback visible to A: %s', n);
  assert not exists (select 1 from public.merchants where id = '00000000-0000-4000-8000-0000000000b2'), 'A must not see merchant B';

  -- allowed: profile columns on the own row
  update public.merchants set seller_name = 'Store A renamed', vat_number = '300000000000003'
   where id = '00000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  assert n = 1, 'A must be able to update its own seller_name/vat_number';

  -- another merchant's row is invisible to UPDATE
  update public.merchants set seller_name = 'pwned' where id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'A must not update merchant B';

  -- F01: plan / subscription / routing / token columns are not writable
  begin
    update public.merchants set plan = 'pro' where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'merchants.plan must not be writable by the merchant';
  exception when insufficient_privilege then null; end;
  begin
    update public.merchants set subscription_status = 'active' where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'merchants.subscription_status must not be writable by the merchant';
  exception when insufficient_privilege then null; end;
  begin
    update public.merchants set salla_merchant_id = '777' where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'merchants.salla_merchant_id must not be writable by the merchant';
  exception when insufficient_privilege then null; end;
  begin
    update public.merchants set access_token = 'x', zatca_csid = 'y' where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'merchants token/zatca columns must not be writable by the merchant';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.merchants (owner_user_id, seller_name, plan, subscription_status)
    values ('00000000-0000-4000-8000-0000000000a1', 'second store', 'pro', 'active');
    raise exception 'merchants must not be insertable by the merchant';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.merchants where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'merchants must not be deletable through the Data API';
  exception when insufficient_privilege then null; end;

  -- billing intents and ZATCA invoices are server-written
  begin
    update public.billing_payments set amount_halalas = 100;
    raise exception 'billing_payments.amount_halalas must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.billing_payments (merchant_id, given_id, plan, amount_halalas)
    values ('00000000-0000-4000-8000-0000000000a2', gen_random_uuid(), 'pro', 100);
    raise exception 'billing_payments must not be insertable';
  exception when insufficient_privilege then null; end;
  begin
    update public.invoices set status = 'cleared', icv = 99;
    raise exception 'invoices must not be writable';
  exception when insufficient_privilege then null; end;

  -- AI employees: profile edits yes, status/billing/hiring no
  update public.ai_employees set display_name = 'Layla Pro', tone = 'friendly'
   where id = '00000000-0000-4000-8000-0000000000a3';
  get diagnostics n = row_count;
  assert n = 1, 'A must be able to edit its employee profile';
  begin
    update public.ai_employees set billing_status = 'active' where id = '00000000-0000-4000-8000-0000000000a3';
    raise exception 'ai_employees.billing_status must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    update public.ai_employees set status = 'paused' where id = '00000000-0000-4000-8000-0000000000a3';
    raise exception 'ai_employees.status must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    update public.ai_employees set monthly_charge_halalas = 1, trial_ends_at = now() + interval '10 years'
     where id = '00000000-0000-4000-8000-0000000000a3';
    raise exception 'ai_employees billing columns must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.ai_employees (merchant_id, role_id, display_name)
    values ('00000000-0000-4000-8000-0000000000a2', 'sales-rep', 'Free seat');
    raise exception 'ai_employees must not be insertable';
  exception when insufficient_privilege then null; end;

  -- voice: settings yes, phone routing no, other merchants no
  update public.voice_configs set dialect = 'msa', hours = '9-5' where merchant_id = '00000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  assert n = 1, 'A must be able to edit its voice settings';
  begin
    update public.voice_configs set phone_number = '+966500000002' where merchant_id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'voice_configs.phone_number must not be writable (call hijack)';
  exception when insufficient_privilege then null; end;
  begin
    update public.voice_configs set twilio_incoming_sid = 'PN-B' where merchant_id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'voice_configs.twilio_incoming_sid must not be writable';
  exception when insufficient_privilege then null; end;
  update public.voice_configs set dialect = 'msa' where merchant_id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'A must not update merchant B voice settings';

  -- social channels (inbound routing keys) are server-written
  begin
    update public.social_channels set external_id = 'ig-b';
    raise exception 'social_channels.external_id must not be writable';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.social_channels (merchant_id, platform, external_id)
    values ('00000000-0000-4000-8000-0000000000a2', 'tiktok', 'tt-b');
    raise exception 'social_channels must not be insertable';
  exception when insufficient_privilege then null; end;

  -- system tables are invisible to the Data API
  begin
    perform 1 from public.events;
    raise exception 'events must not be readable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.events (kind, merchant) values ('social.escalation', '00000000-0000-4000-8000-0000000000a2');
    raise exception 'events must not be writable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.wathq_cache;
    raise exception 'wathq_cache must not be readable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.wathq_cache (cr_number, payload) values ('2020202020', '{"crEntityStatus": "forged"}');
    raise exception 'wathq_cache must not be writable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.platform_settings;
    raise exception 'platform_settings must not be readable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.webhook_events;
    raise exception 'webhook_events must not be readable by merchants';
  exception when insufficient_privilege then null; end;

  -- server-written tables
  begin
    insert into public.agent_settings (merchant_id, persona_role, enabled) values ('00000000-0000-4000-8000-0000000000a2', 'voice', true);
    raise exception 'agent_settings must not be writable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.support_tickets (user_id, category, message) values ('00000000-0000-4000-8000-0000000000a1', 'help', 'direct insert');
    raise exception 'support_tickets must not be writable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_feedback (user_id, sentiment) values ('00000000-0000-4000-8000-0000000000a1', 'up');
    raise exception 'user_feedback must not be writable by merchants';
  exception when insufficient_privilege then null; end;

  -- merchant-authored content: own rows yes, foreign merchant rejected by RLS
  update public.brand_kits set essence = 'Own essence' where merchant_id = '00000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  assert n = 1, 'A must be able to edit its brand kit';
  insert into public.social_plans (merchant_id, horizon_days, raw_plan)
  values ('00000000-0000-4000-8000-0000000000a2', 7, '[]');
  begin
    insert into public.social_plans (merchant_id, horizon_days, raw_plan)
    values ('00000000-0000-4000-8000-0000000000b2', 7, '[]');
    raise exception 'A must not create content for merchant B';
  exception when insufficient_privilege then null; end;

  -- RPCs
  begin
    perform public.claim_voice_number_provisioning('00000000-0000-4000-8000-0000000000a2');
    raise exception 'claim_voice_number_provisioning must not be callable by merchants';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_webhook_event('moyasar', 'evt');
    raise exception 'claim_webhook_event must not be callable by merchants';
  exception when insufficient_privilege then null; end;
end $$;

reset role;

-- ── anonymous (public anon key, no session) ──────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true) as jwt_claims \gset
do $$
declare
  t text;
begin
  foreach t in array array['merchants', 'invoices', 'billing_payments', 'events', 'wathq_cache', 'brand_kits', 'agent_settings', 'support_tickets'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'anon must not read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

-- nothing A attempted leaked into the data
do $$ begin
  assert (select plan from public.merchants where id = '00000000-0000-4000-8000-0000000000a2') = 'lite', 'plan changed';
  assert (select subscription_status from public.merchants where id = '00000000-0000-4000-8000-0000000000a2') = 'pending', 'subscription_status changed';
  assert (select salla_merchant_id from public.merchants where id = '00000000-0000-4000-8000-0000000000a2') is null, 'salla_merchant_id changed';
  assert (select seller_name from public.merchants where id = '00000000-0000-4000-8000-0000000000a2') = 'Store A renamed', 'allowed update lost';
  assert (select seller_name from public.merchants where id = '00000000-0000-4000-8000-0000000000b2') = 'Store B', 'merchant B modified';
  assert (select count(*) from public.billing_payments where amount_halalas <> 59900) = 0, 'billing amount changed';
  assert (select billing_status from public.ai_employees where id = '00000000-0000-4000-8000-0000000000a3') = 'trial', 'billing_status changed';
  assert (select phone_number from public.voice_configs where merchant_id = '00000000-0000-4000-8000-0000000000a2') is null, 'phone number squatted';
  assert (select count(*) from public.wathq_cache) = 1, 'wathq_cache modified';
end $$;

rollback;
