-- ZATCA tables and functions are service-role only (20261106003500_zatca_phase2.sql,
-- 20261106003600_pending_salla_orders.sql); EGS secrets can only be stored as enc:v1: ciphertext;
-- a merchant still reads its own invoices (with the Phase-2 columns) and nobody else's.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000046a1', 'zatca-priv-a@test.example'),
  ('00000000-0000-4000-8000-0000000046b1', 'zatca-priv-b@test.example');
insert into public.merchants (id, owner_user_id, seller_name, plan) values
  ('00000000-0000-4000-8000-0000000046a2', '00000000-0000-4000-8000-0000000046a1', 'A', 'lite'),
  ('00000000-0000-4000-8000-0000000046b2', '00000000-0000-4000-8000-0000000046b1', 'B', 'lite');

do $$
declare
  t text;
  p text;
  f text;
begin
  foreach t in array array['public.zatca_egs_units', 'public.zatca_chain_heads', 'public.pending_salla_orders'] loop
    assert (select relrowsecurity from pg_class where oid = t::regclass), format('RLS must be on for %s', t);
    assert not exists (select 1 from pg_policies where schemaname || '.' || tablename = t), format('%s is service-role only: no policies', t);
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert not has_table_privilege('anon', t, p), format('anon must not have %s on %s', p, t);
      assert not has_table_privilege('authenticated', t, p), format('authenticated must not have %s on %s', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      assert not has_any_column_privilege('authenticated', t, p), format('authenticated must not have column %s on %s', p, t);
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('service_role', t, p), format('service_role needs %s on %s', p, t);
    end loop;
  end loop;
  assert not has_sequence_privilege('authenticated', 'public.pending_salla_orders_id_seq', 'USAGE'), 'sequence is service-role only';
  assert has_sequence_privilege('service_role', 'public.pending_salla_orders_id_seq', 'USAGE'), 'service_role uses the sequence';

  foreach f in array array[
    'public.zatca_append_invoice(uuid,integer,text,text,jsonb,uuid)',
    'public.claim_pending_salla_orders(uuid,text,integer)'] loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon must not execute %s', f);
    assert not has_function_privilege('authenticated', f, 'execute'), format('authenticated must not execute %s', f);
    assert has_function_privilege('service_role', f, 'execute'), format('service_role must execute %s', f);
  end loop;

  -- invoices stay read-only for the owner (writes are service-role, incl. every new column)
  foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
    assert not has_table_privilege('authenticated', 'public.invoices', p), format('authenticated must not %s invoices', p);
  end loop;
  foreach p in array array['status', 'cleared_xml', 'validation_errors', 'superseded_by', 'icv', 'invoice_hash'] loop
    assert not has_column_privilege('authenticated', 'public.invoices', p, 'UPDATE'), format('invoices.%s must not be client-writable', p);
  end loop;
  -- merchants.zatca_* stay server-side
  foreach p in array array['zatca_onboarded_at', 'zatca_csid', 'zatca_private_key_encrypted'] loop
    assert not has_column_privilege('authenticated', 'public.merchants', p, 'UPDATE'), format('merchants.%s must not be client-writable', p);
  end loop;
end $$;

-- ── ciphertext only ───────────────────────────────────────────────────────────
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000046a2';
begin
  begin
    insert into public.zatca_egs_units (merchant_id, environment, status, common_name, egs_serial_number, csr_pem, private_key_encrypted)
    values (a, 'sandbox', 'compliance_issued', 'cn', '1-a|2-b|3-c', 'CSR', '-----BEGIN PRIVATE KEY-----');
    assert false, 'a plaintext private key must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.zatca_egs_units (merchant_id, environment, status, common_name, egs_serial_number, csr_pem, private_key_encrypted, compliance_secret_encrypted)
    values (a, 'sandbox', 'compliance_issued', 'cn', '1-a|2-b|3-c', 'CSR', 'enc:v1:k', 'plain-secret');
    assert false, 'a plaintext CSID secret must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.zatca_egs_units (merchant_id, environment, status, common_name, egs_serial_number, csr_pem, private_key_encrypted)
    values (a, 'sandbox', 'active', 'cn', '1-a|2-b|3-c', 'CSR', 'enc:v1:k');
    assert false, 'active needs a production CSID';
  exception when check_violation then null;
  end;
  insert into public.zatca_egs_units (merchant_id, environment, status, common_name, egs_serial_number, csr_pem, private_key_encrypted,
                                      production_token_encrypted, production_secret_encrypted)
  values (a, 'sandbox', 'active', 'cn', '1-a|2-b|3-c', 'CSR', 'enc:v1:k', 'enc:v1:t', 'enc:v1:s');
end $$;

-- ── a signed-in merchant: own invoices readable, ZATCA internals invisible ────
insert into public.invoices (merchant_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml, status, invoice_type, cleared_xml)
values ('00000000-0000-4000-8000-0000000046a2', 'A-1', gen_random_uuid(), 1, 'H', 'Q', '<x/>', 'cleared', 'standard', '<cleared/>'),
       ('00000000-0000-4000-8000-0000000046b2', 'B-1', gen_random_uuid(), 1, 'H', 'Q', '<x/>', 'reported', 'simplified', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000046a1","role":"authenticated"}', true);

do $$
begin
  assert (select count(*) from public.invoices) = 1, 'a merchant sees only its own invoices';
  assert (select cleared_xml from public.invoices where invoice_number = 'A-1') = '<cleared/>', 'Phase-2 columns readable by the owner';
  begin
    perform 1 from public.zatca_egs_units;
    assert false, 'zatca_egs_units must not be readable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.pending_salla_orders;
    assert false, 'pending_salla_orders must not be readable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.zatca_append_invoice('00000000-0000-4000-8000-0000000046a2', 2, 'H', 'sandbox', '{}'::jsonb);
    assert false, 'authenticated must not append invoices';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.invoices set status = 'cleared' where invoice_number = 'A-1';
    assert false, 'authenticated must not update invoices';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
