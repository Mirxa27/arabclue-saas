-- Data API privilege model (critic-13). Runs in both DB_TEST_GRANTS modes: the
-- migrations must end in the same privileges whether Supabase auto-granted every new
-- object to the API roles (legacy) or nothing at all (opt-in).
do $$
declare
  t text;
  p text;
  c record;
  all_tables text[] := array[
    'merchants', 'brand_kits', 'invoices', 'social_plans', 'social_posts', 'wathq_cache',
    'events', 'salla_products', 'social_channels', 'voice_configs', 'bookings', 'seo_content',
    'billing_payments', 'platform_settings', 'webhook_events', 'ai_employees',
    'ai_employee_integrations', 'ai_employee_conversations', 'ai_employee_messages',
    'ai_employee_tasks', 'ai_employee_actions', 'ai_employee_heartbeats',
    'agent_settings', 'support_tickets', 'user_feedback'];
  -- no Data API access for anon or authenticated
  service_only text[] := array['events', 'wathq_cache', 'platform_settings', 'webhook_events'];
  -- authenticated may read (RLS) but never write
  read_only text[] := array[
    'invoices', 'billing_payments', 'social_channels', 'ai_employee_actions',
    'ai_employee_heartbeats', 'agent_settings', 'support_tickets', 'user_feedback'];
  -- merchant-authored content: owner-scoped DML through RLS
  content text[] := array[
    'brand_kits', 'social_plans', 'social_posts', 'salla_products', 'bookings', 'seo_content',
    'ai_employee_integrations', 'ai_employee_conversations', 'ai_employee_messages',
    'ai_employee_tasks'];
  -- the only merchant-writable columns (keep in sync with 20261106001100_api_grants.sql)
  merchant_update_cols text[] := array[
    'seller_name', 'vat_number', 'cr_number', 'seller_address', 'store_url',
    'dpa_accepted_at', 'dpa_version'];
  voice_write_cols text[] := array[
    'merchant_id', 'dialect', 'hours', 'escalation_phone', 'knowledge', 'enabled', 'updated_at'];
  employee_update_cols text[] := array[
    'display_name', 'avatar', 'language', 'tone', 'timezone', 'working_hours', 'knowledge',
    'goals', 'config', 'updated_at'];
begin
  foreach t in array all_tables loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
      format('RLS must be enabled on %s', t);
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert not has_table_privilege('anon', 'public.' || t, p), format('anon must not have %s on %s', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      assert not has_any_column_privilege('anon', 'public.' || t, p), format('anon must not have column %s on %s', p, t);
    end loop;
    foreach p in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert not has_table_privilege('authenticated', 'public.' || t, p),
        format('authenticated must not have %s on %s (not RLS-checked)', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('service_role', 'public.' || t, p), format('service_role needs %s on %s', p, t);
    end loop;
  end loop;

  -- every table in public has RLS (also catches tables added by later migrations)
  for c in
    select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity
  loop
    raise exception 'table public.% has RLS disabled', c.relname;
  end loop;

  -- anon reaches nothing in public — including objects added by later migrations, which
  -- legacy projects auto-grant to anon unless the creating migration revokes it
  for c in
    select relname from pg_class
     where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm')
       and (has_table_privilege('anon', oid, 'SELECT') or has_table_privilege('anon', oid, 'INSERT')
            or has_table_privilege('anon', oid, 'UPDATE') or has_table_privilege('anon', oid, 'DELETE')
            or has_any_column_privilege('anon', oid, 'SELECT') or has_any_column_privilege('anon', oid, 'INSERT')
            or has_any_column_privilege('anon', oid, 'UPDATE'))
  loop
    raise exception 'anon has Data API privileges on public.% — revoke them in the migration that creates it', c.relname;
  end loop;
  for c in
    select p.oid::regprocedure::text as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    raise exception 'anon can execute % — revoke execute from public, anon in the migration that creates it', c.fn;
  end loop;

  foreach t in array service_only loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert not has_table_privilege('authenticated', 'public.' || t, p), format('authenticated must not have %s on %s', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      assert not has_any_column_privilege('authenticated', 'public.' || t, p), format('authenticated must not have column %s on %s', p, t);
    end loop;
  end loop;

  foreach t in array read_only loop
    assert has_table_privilege('authenticated', 'public.' || t, 'SELECT'), format('authenticated must read %s', t);
    assert not has_table_privilege('authenticated', 'public.' || t, 'DELETE'), format('authenticated must not delete %s', t);
    foreach p in array array['INSERT', 'UPDATE'] loop
      assert not has_any_column_privilege('authenticated', 'public.' || t, p), format('authenticated must not %s %s', p, t);
    end loop;
  end loop;

  foreach t in array content loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('authenticated', 'public.' || t, p), format('authenticated needs %s on %s', p, t);
    end loop;
  end loop;

  -- merchants: read + UPDATE of the profile/consent columns only; never INSERT/DELETE
  assert has_table_privilege('authenticated', 'public.merchants', 'SELECT'), 'authenticated must read merchants';
  assert not has_table_privilege('authenticated', 'public.merchants', 'UPDATE'), 'merchants UPDATE must be column-scoped';
  assert not has_table_privilege('authenticated', 'public.merchants', 'DELETE'), 'authenticated must not delete merchants';
  assert not has_any_column_privilege('authenticated', 'public.merchants', 'INSERT'), 'merchants are created server-side only';
  for c in select attname from pg_attribute where attrelid = 'public.merchants'::regclass and attnum > 0 and not attisdropped loop
    assert has_column_privilege('authenticated', 'public.merchants', c.attname, 'UPDATE') = (c.attname = any (merchant_update_cols)),
      format('merchants.%s: authenticated UPDATE must be %s (allow-list in 20261106001100_api_grants.sql)', c.attname, c.attname = any (merchant_update_cols));
  end loop;
  assert not has_column_privilege('authenticated', 'public.merchants', 'plan', 'UPDATE'), 'plan must not be client-writable';
  assert not has_column_privilege('authenticated', 'public.merchants', 'subscription_status', 'UPDATE'), 'subscription_status must not be client-writable';
  assert not has_column_privilege('authenticated', 'public.merchants', 'salla_merchant_id', 'UPDATE'), 'salla_merchant_id must not be client-writable';

  -- voice_configs: settings columns only; phone routing columns are server-side
  assert not has_table_privilege('authenticated', 'public.voice_configs', 'INSERT'), 'voice_configs INSERT must be column-scoped';
  assert not has_table_privilege('authenticated', 'public.voice_configs', 'UPDATE'), 'voice_configs UPDATE must be column-scoped';
  assert not has_table_privilege('authenticated', 'public.voice_configs', 'DELETE'), 'authenticated must not delete voice_configs';
  for c in select attname from pg_attribute where attrelid = 'public.voice_configs'::regclass and attnum > 0 and not attisdropped loop
    assert has_column_privilege('authenticated', 'public.voice_configs', c.attname, 'INSERT') = (c.attname = any (voice_write_cols)),
      format('voice_configs.%s: unexpected authenticated INSERT privilege', c.attname);
    assert has_column_privilege('authenticated', 'public.voice_configs', c.attname, 'UPDATE') = (c.attname = any (voice_write_cols)),
      format('voice_configs.%s: unexpected authenticated UPDATE privilege', c.attname);
  end loop;

  -- ai_employees: persona/profile columns only; hiring, status and billing are server-side
  assert not has_any_column_privilege('authenticated', 'public.ai_employees', 'INSERT'), 'employees are hired server-side only';
  assert not has_table_privilege('authenticated', 'public.ai_employees', 'DELETE'), 'authenticated must not delete ai_employees';
  for c in select attname from pg_attribute where attrelid = 'public.ai_employees'::regclass and attnum > 0 and not attisdropped loop
    assert has_column_privilege('authenticated', 'public.ai_employees', c.attname, 'UPDATE') = (c.attname = any (employee_update_cols)),
      format('ai_employees.%s: authenticated UPDATE must be %s', c.attname, c.attname = any (employee_update_cols));
  end loop;

  -- merchants keep no INSERT/DELETE/ALL policy for the API roles
  assert not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'merchants' and cmd in ('INSERT', 'DELETE', 'ALL')
  ), 'merchants must not have INSERT/DELETE/ALL policies';
  assert not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('invoices', 'billing_payments', 'social_channels', 'voice_configs', 'ai_employees', 'agent_settings', 'support_tickets', 'user_feedback')
       and cmd = 'ALL'
  ), 'locked tables must not keep FOR ALL policies';

  -- sequences
  foreach t in array array['events_id_seq', 'webhook_events_id_seq', 'ai_employee_actions_id_seq'] loop
    assert not has_sequence_privilege('anon', 'public.' || t, 'USAGE'), format('anon must not use %s', t);
    assert not has_sequence_privilege('authenticated', 'public.' || t, 'USAGE'), format('authenticated must not use %s', t);
    assert has_sequence_privilege('service_role', 'public.' || t, 'USAGE'), format('service_role must use %s', t);
  end loop;

  -- RPCs are server-only
  foreach t in array array[
    'public.claim_webhook_event(text,text,text,integer)',
    'public.prune_webhook_events(integer)',
    'public.claim_voice_number_provisioning(uuid,boolean,integer,integer)'] loop
    assert not has_function_privilege('anon', t, 'EXECUTE'), format('anon must not execute %s', t);
    assert not has_function_privilege('authenticated', t, 'EXECUTE'), format('authenticated must not execute %s', t);
    assert has_function_privilege('service_role', t, 'EXECUTE'), format('service_role must execute %s', t);
  end loop;
  assert not has_function_privilege('anon', 'public.set_updated_at()', 'EXECUTE'), 'set_updated_at is trigger-only';
  assert not has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE'), 'set_updated_at is trigger-only';
end $$;
