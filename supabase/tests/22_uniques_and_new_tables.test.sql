-- Routing-key uniqueness (F01/F34/F35, UI-006), agent_settings (F13/UI-007),
-- support_tickets / user_feedback (F20/UI-018), ai_employees.updated_at.
do $$
declare
  idx record;
begin
  -- the indexes exist and are unique (partial where the column is nullable routing data)
  for idx in
    select * from (values
      ('merchants_owner_user_id_key', false),
      ('brand_kits_merchant_id_key', false),
      ('voice_configs_phone_number_key', true),
      ('social_channels_platform_external_id_key', true),
      ('agent_settings_merchant_persona_key', false)
    ) as v(name, partial)
  loop
    assert exists (
      select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname = idx.name and c.relnamespace = 'public'::regnamespace and i.indisunique
         and (i.indpred is not null) = idx.partial
    ), format('unique index %s missing (partial=%s)', idx.name, idx.partial);
  end loop;
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'c@example.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'd@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1', 'Store C'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d1', 'Store D');

do $$
declare
  n integer;
begin
  -- one merchant per auth user
  begin
    insert into public.merchants (owner_user_id, seller_name) values ('00000000-0000-4000-8000-0000000000c1', 'Store C again');
    raise exception 'a second merchant for the same user must be rejected';
  exception when unique_violation then null; end;
  -- unowned (Salla easy-mode) merchants are still allowed side by side
  insert into public.merchants (seller_name) values ('unowned 1'), ('unowned 2');

  -- a Twilio number routes to exactly one merchant; unprovisioned configs are fine
  insert into public.voice_configs (merchant_id, phone_number) values ('00000000-0000-4000-8000-0000000000c2', '+966500000100');
  begin
    insert into public.voice_configs (merchant_id, phone_number) values ('00000000-0000-4000-8000-0000000000d2', '+966500000100');
    raise exception 'duplicate phone_number must be rejected';
  exception when unique_violation then null; end;
  insert into public.voice_configs (merchant_id, phone_number) values ('00000000-0000-4000-8000-0000000000d2', null);

  -- a provider account belongs to exactly one merchant; same platform, other accounts fine
  insert into public.social_channels (merchant_id, platform, external_id) values ('00000000-0000-4000-8000-0000000000c2', 'instagram', 'ig-shared');
  begin
    insert into public.social_channels (merchant_id, platform, external_id) values ('00000000-0000-4000-8000-0000000000d2', 'instagram', 'ig-shared');
    raise exception 'duplicate (platform, external_id) must be rejected';
  exception when unique_violation then null; end;
  insert into public.social_channels (merchant_id, platform, external_id) values ('00000000-0000-4000-8000-0000000000d2', 'instagram', 'ig-d');
  insert into public.social_channels (merchant_id, platform, external_id) values ('00000000-0000-4000-8000-0000000000d2', 'x', 'ig-shared');

  -- UI-006: the brand-kit upsert conflict target now exists
  insert into public.brand_kits (merchant_id, brand_name, essence) values ('00000000-0000-4000-8000-0000000000c2', 'C', 'v1')
    on conflict (merchant_id) do update set essence = excluded.essence;
  insert into public.brand_kits (merchant_id, brand_name, essence) values ('00000000-0000-4000-8000-0000000000c2', 'C', 'v2')
    on conflict (merchant_id) do update set essence = excluded.essence;
  select count(*) into n from public.brand_kits where merchant_id = '00000000-0000-4000-8000-0000000000c2';
  assert n = 1, format('brand kit upsert must keep one row, got %s', n);
  assert (select essence from public.brand_kits where merchant_id = '00000000-0000-4000-8000-0000000000c2') = 'v2', 'brand kit upsert must update';

  -- agent_settings: one row per persona, upsertable on (merchant_id, persona_role)
  insert into public.agent_settings (merchant_id, persona_role, enabled, status)
  values ('00000000-0000-4000-8000-0000000000c2', 'social', true, 'active')
  on conflict (merchant_id, persona_role) do update set enabled = excluded.enabled, status = excluded.status;
  insert into public.agent_settings (merchant_id, persona_role, enabled, status)
  values ('00000000-0000-4000-8000-0000000000c2', 'social', false, 'idle')
  on conflict (merchant_id, persona_role) do update set enabled = excluded.enabled, status = excluded.status;
  assert (select count(*) from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000000c2') = 1, 'agent_settings upsert must keep one row';
  assert not (select enabled from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000000c2' and persona_role = 'social'), 'agent_settings upsert must update';
  -- updated_at is stamped by the trigger, whatever the writer sends
  update public.agent_settings set updated_at = '2000-01-01', last_error = 'boom'
   where merchant_id = '00000000-0000-4000-8000-0000000000c2' and persona_role = 'social';
  assert (select updated_at from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000000c2' and persona_role = 'social') > '2001-01-01',
    'agent_settings.updated_at must be maintained by the trigger';
  begin
    insert into public.agent_settings (merchant_id, persona_role) values ('00000000-0000-4000-8000-0000000000c2', 'sales-rep');
    raise exception 'marketplace role ids are not persona roles';
  exception when check_violation then null; end;
  begin
    insert into public.agent_settings (merchant_id, persona_role, status) values ('00000000-0000-4000-8000-0000000000c2', 'voice', 'running');
    raise exception 'unknown agent status must be rejected';
  exception when check_violation then null; end;
  begin
    insert into public.agent_settings (merchant_id, persona_role, overrides) values ('00000000-0000-4000-8000-0000000000c2', 'seo', '[]');
    raise exception 'overrides must be a JSON object';
  exception when check_violation then null; end;

  -- F13: the employee status route's updated_at column exists and is trigger-maintained
  insert into public.ai_employees (id, merchant_id, role_id, display_name)
  values ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c2', 'sales-rep', 'Layla');
  update public.ai_employees set status = 'paused', updated_at = '2000-01-01' where id = '00000000-0000-4000-8000-0000000000c3';
  assert (select updated_at from public.ai_employees where id = '00000000-0000-4000-8000-0000000000c3') > '2001-01-01',
    'ai_employees.updated_at must be set by the trigger';

  -- support tickets / feedback constraints
  insert into public.support_tickets (user_id, merchant_id, category, message, contact_email)
  values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', 'billing', 'Need an invoice copy', 'c@example.test');
  begin
    insert into public.support_tickets (user_id, category, message) values ('00000000-0000-4000-8000-0000000000c1', 'help', 'hey');
    raise exception 'too-short support message must be rejected';
  exception when check_violation then null; end;
  begin
    insert into public.support_tickets (user_id, category, message) values ('00000000-0000-4000-8000-0000000000c1', 'spam', 'valid length message');
    raise exception 'unknown support category must be rejected';
  exception when check_violation then null; end;
  insert into public.user_feedback (user_id, merchant_id, sentiment, reasons, note, path)
  values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2', 'down', array['slow'], 'Too slow', '/dashboard');
  begin
    insert into public.user_feedback (user_id, sentiment) values ('00000000-0000-4000-8000-0000000000c1', 'meh');
    raise exception 'unknown sentiment must be rejected';
  exception when check_violation then null; end;

  -- PDPL: deleting the auth user removes their tickets and feedback
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000c1';
  assert not exists (select 1 from public.support_tickets where user_id = '00000000-0000-4000-8000-0000000000c1'), 'tickets must be erased with the account';
  assert not exists (select 1 from public.user_feedback where user_id = '00000000-0000-4000-8000-0000000000c1'), 'feedback must be erased with the account';
end $$;

rollback;
