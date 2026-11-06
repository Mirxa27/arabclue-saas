-- ZATCA document chain (20261106003500_zatca_phase2.sql): zatca_append_invoice allocates ICV and
-- previous-invoice hash atomically under a per-merchant lock (F09 / critic-24).
--   Part 1 (rolled back): allocation rules, Salla-order idempotency, supersession, environments,
--                          continuation of legacy ICVs.
--   Part 2 (two sessions via dblink, committed fixtures removed at the end): a second session is
--                          blocked by the first one's head-row lock for the same merchant only, and
--                          a writer that read a stale head is told so instead of forking the chain.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000045a1', 'zatca-a@test.example'),
  ('00000000-0000-4000-8000-0000000045b1', 'zatca-b@test.example');
insert into public.merchants (id, owner_user_id, seller_name, plan) values
  ('00000000-0000-4000-8000-0000000045a2', '00000000-0000-4000-8000-0000000045a1', 'A', 'lite'),
  ('00000000-0000-4000-8000-0000000045b2', '00000000-0000-4000-8000-0000000045b1', 'B', 'lite');

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000045a2';
  b constant uuid := '00000000-0000-4000-8000-0000000045b2';
  genesis constant text := 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
  r jsonb;
  first_id uuid;
  rejected_id uuid;
  inv jsonb;
begin
  -- helper shape of one invoice
  inv := jsonb_build_object('invoice_number', 'INV-1', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASH1', 'qr_base64', 'QR',
                            'xml', '<Invoice/>', 'subtotal', 100, 'vat', 15, 'total', 115, 'invoice_type', 'simplified',
                            'salla_order_id', 'order-1', 'issued_at', now(), 'buyer_name', 'محمد',
                            'issue_input', jsonb_build_object('invoiceType', 'simplified', 'lines', jsonb_build_array(jsonb_build_object('name', 'عود'))));

  -- the first document of a chain must use ICV 1 and the genesis PIH
  r := public.zatca_append_invoice(a, 1, 'not-the-genesis-hash', 'sandbox', inv);
  assert r ->> 'outcome' = 'head_moved', format('wrong PIH must be refused: %s', r);
  assert (r ->> 'icv')::int = 1 and r ->> 'previous_hash' = genesis, format('head_moved names the expected head: %s', r);
  r := public.zatca_append_invoice(a, 2, genesis, 'sandbox', inv);
  assert r ->> 'outcome' = 'head_moved', format('skipping an ICV must be refused: %s', r);

  r := public.zatca_append_invoice(a, 1, genesis, 'sandbox', inv);
  assert r ->> 'outcome' = 'inserted', format('first document: %s', r);
  first_id := (r ->> 'id')::uuid;
  assert (select status from public.invoices where id = first_id) = 'generated', 'new documents start as generated';
  assert (select previous_invoice_hash from public.invoices where id = first_id) = genesis, 'PIH stored';
  assert (select environment from public.invoices where id = first_id) = 'sandbox', 'environment stored';
  assert (select buyer_name from public.invoices where id = first_id) = 'محمد', 'buyer name stored';
  assert (select issue_input #>> '{lines,0,name}' from public.invoices where id = first_id) = 'عود', 'issue input stored for reissues';
  assert (select last_icv from public.zatca_chain_heads where merchant_id = a) = 1, 'head advanced to ICV 1';
  assert (select last_hash from public.zatca_chain_heads where merchant_id = a) = 'HASH1', 'head hash = document hash';

  -- a redelivered order is answered with the existing invoice (and consumes no ICV)
  r := public.zatca_append_invoice(a, 2, 'HASH1', 'sandbox', inv || jsonb_build_object('invoice_hash', 'HASH-DUP', 'uuid', gen_random_uuid()));
  assert r ->> 'outcome' = 'duplicate_order' and (r ->> 'id')::uuid = first_id, format('duplicate order: %s', r);
  assert (select last_icv from public.zatca_chain_heads where merchant_id = a) = 1, 'a duplicate does not advance the head';

  -- the next document chains to the previous hash
  r := public.zatca_append_invoice(a, 2, 'HASH1', 'sandbox',
         inv || jsonb_build_object('invoice_number', 'INV-2', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASH2', 'salla_order_id', 'order-2'));
  assert r ->> 'outcome' = 'inserted', format('second document: %s', r);
  rejected_id := (r ->> 'id')::uuid;

  -- a stale writer (still holding ICV 2 / HASH1) is told the head moved — no fork, no reused ICV
  r := public.zatca_append_invoice(a, 2, 'HASH1', 'sandbox',
         inv || jsonb_build_object('invoice_number', 'INV-X', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASHX', 'salla_order_id', 'order-x'));
  assert r ->> 'outcome' = 'head_moved' and (r ->> 'icv')::int = 3 and r ->> 'previous_hash' = 'HASH2', format('stale writer: %s', r);

  -- a rejected document can be reissued for the same order: the new one supersedes it atomically
  r := public.zatca_append_invoice(a, 3, 'HASH2', 'sandbox',
         inv || jsonb_build_object('invoice_number', 'INV-2-R1', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASH3', 'salla_order_id', 'order-2'),
         rejected_id);
  assert r ->> 'outcome' = 'not_supersedable', format('only rejected documents can be superseded: %s', r);
  update public.invoices set status = 'rejected' where id = rejected_id;
  r := public.zatca_append_invoice(a, 3, 'HASH2', 'sandbox',
         inv || jsonb_build_object('invoice_number', 'INV-2-R1', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASH3', 'salla_order_id', 'order-2'),
         rejected_id);
  assert r ->> 'outcome' = 'inserted', format('reissue: %s', r);
  assert (select superseded_by from public.invoices where id = rejected_id) = (r ->> 'id')::uuid, 'rejected document points at its reissue';
  assert (select reissue_of from public.invoices where id = (r ->> 'id')::uuid) = rejected_id, 'reissue points at the rejected document';
  assert (select status from public.invoices where id = rejected_id) = 'rejected', 'the rejected record keeps its status (never rewritten)';
  assert (select count(*) from public.invoices where merchant_id = a and salla_order_id = 'order-2' and superseded_by is null) = 1,
    'one live invoice per order';
  begin
    insert into public.invoices (merchant_id, salla_order_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml)
    values (a, 'order-2', 'RAW', gen_random_uuid(), 99, 'H', 'Q', '<x/>');
    assert false, 'a second live invoice for the same order must violate the partial unique index';
  exception when unique_violation then null;
  end;

  -- a new environment (e.g. sandbox → production) starts a fresh PIH chain; ICVs keep counting
  r := public.zatca_append_invoice(a, 4, 'HASH3', 'production',
         inv || jsonb_build_object('invoice_number', 'INV-P1', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASHP1', 'salla_order_id', 'order-p1'));
  assert r ->> 'outcome' = 'head_moved' and r ->> 'previous_hash' = genesis, format('environment change restarts the PIH: %s', r);
  r := public.zatca_append_invoice(a, 4, genesis, 'production',
         inv || jsonb_build_object('invoice_number', 'INV-P1', 'uuid', gen_random_uuid(), 'invoice_hash', 'HASHP1', 'salla_order_id', 'order-p1'));
  assert r ->> 'outcome' = 'inserted', format('first production document: %s', r);

  -- merchants with pre-Phase-2 invoices continue their ICVs (unique (merchant_id, icv))
  insert into public.invoices (merchant_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml)
  values (b, 'OLD-7', gen_random_uuid(), 7, 'OLDHASH', 'Q', '<x/>');
  r := public.zatca_append_invoice(b, 1, genesis, 'sandbox', inv || jsonb_build_object('uuid', gen_random_uuid(), 'salla_order_id', 'b-1'));
  assert r ->> 'outcome' = 'head_moved' and (r ->> 'icv')::int = 8 and r ->> 'previous_hash' = genesis, format('legacy continuation: %s', r);
  r := public.zatca_append_invoice(b, 8, genesis, 'sandbox', inv || jsonb_build_object('uuid', gen_random_uuid(), 'salla_order_id', 'b-1'));
  assert r ->> 'outcome' = 'inserted', format('legacy continuation insert: %s', r);

  -- required fields
  begin
    perform public.zatca_append_invoice(b, 9, 'HASH1', 'sandbox', inv - 'xml');
    assert false, 'missing xml must raise';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.zatca_append_invoice(b, 9, 'HASH1', 'mars', inv);
    assert false, 'unknown environment must raise';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;


-- ── Part 2: two sessions ─────────────────────────────────────────────────────
-- Session B is a dblink connection. This session (A) runs in autocommit mode and commits inside the
-- DO blocks, so it never holds a lock that B is asked to wait for (that wait would be invisible to
-- the deadlock detector). Fixtures are committed and removed at the end.
delete from public.invoices where merchant_id in ('00000000-0000-4000-8000-0000000045c2', '00000000-0000-4000-8000-0000000045d2');
delete from public.merchants where id in ('00000000-0000-4000-8000-0000000045c2', '00000000-0000-4000-8000-0000000045d2');
delete from auth.users where id in ('00000000-0000-4000-8000-0000000045c1', '00000000-0000-4000-8000-0000000045d1');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000045c1', 'zatca-c@test.example'),
  ('00000000-0000-4000-8000-0000000045d1', 'zatca-d@test.example');
insert into public.merchants (id, owner_user_id, seller_name, plan) values
  ('00000000-0000-4000-8000-0000000045c2', '00000000-0000-4000-8000-0000000045c1', 'C', 'lite'),
  ('00000000-0000-4000-8000-0000000045d2', '00000000-0000-4000-8000-0000000045d1', 'D', 'lite');

do $$
declare
  c constant uuid := '00000000-0000-4000-8000-0000000045c2';
  d constant uuid := '00000000-0000-4000-8000-0000000045d2';
  genesis constant text := 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
  r jsonb;
  b_result jsonb;
  a_first jsonb;
  waited integer := 0;
  doc constant text := $f$jsonb_build_object('invoice_number', %L, 'uuid', gen_random_uuid(), 'invoice_hash', %L, 'qr_base64', 'QR',
                          'xml', '<Invoice/>', 'invoice_type', 'simplified', 'salla_order_id', %L)$f$;
begin
  if not exists (select 1 from pg_available_extensions where name = 'dblink') then
    raise notice '45_zatca_chain: dblink is not installed — two-session test skipped';
    return;
  end if;
  execute 'create extension if not exists dblink';
  commit;
  perform dblink_connect('zatca_b', format('dbname=%s user=%s host=%s port=%s', current_database(), current_user,
                         split_part(current_setting('unix_socket_directories'), ',', 1), current_setting('port')));

  -- 1. B opens a transaction and appends C's first document: B holds C's head-row lock.
  perform dblink_exec('zatca_b', 'begin');
  select t.r::jsonb into b_result from dblink('zatca_b', format('select public.zatca_append_invoice(%L::uuid, 1, %L, %L, %s)::text',
    c, genesis, 'sandbox', format(doc, 'B-1', 'B-HASH-1', 'c-order-b'))) as t(r text);
  assert b_result ->> 'outcome' = 'inserted', format('session B append: %s', b_result);

  -- A, holding the same head (ICV 1, genesis), has to wait for B — with a lock timeout it gives up.
  begin
    perform set_config('lock_timeout', '500ms', true);
    execute format('select public.zatca_append_invoice(%L::uuid, 1, %L, %L, %s)', c, genesis, 'sandbox', format(doc, 'A-1', 'A-HASH-1', 'c-order-a'));
    assert false, 'session A must be blocked by session B''s head-row lock';
  exception when lock_not_available then null;
  end;
  perform set_config('lock_timeout', '0', true);

  -- the lock is per merchant: D is not blocked by B's open transaction
  execute format('select public.zatca_append_invoice(%L::uuid, 1, %L, %L, %s)', d, genesis, 'sandbox', format(doc, 'D-1', 'D-HASH-1', 'd-order')) into r;
  assert r ->> 'outcome' = 'inserted', format('other merchant while C is locked: %s', r);
  commit;

  -- 2. B commits. A retries with the head it had read and is told the head moved (no fork) …
  perform dblink_exec('zatca_b', 'commit');
  execute format('select public.zatca_append_invoice(%L::uuid, 1, %L, %L, %s)', c, genesis, 'sandbox', format(doc, 'A-1', 'A-HASH-1', 'c-order-a')) into r;
  assert r ->> 'outcome' = 'head_moved' and (r ->> 'icv')::int = 2 and r ->> 'previous_hash' = 'B-HASH-1', format('stale session A: %s', r);
  -- … and, re-signed with the fresh head, chains onto B's document.
  execute format('select public.zatca_append_invoice(%L::uuid, 2, %L, %L, %s)', c, 'B-HASH-1', 'sandbox', format(doc, 'A-1', 'A-HASH-2', 'c-order-a')) into r;
  assert r ->> 'outcome' = 'inserted', format('retry with the fresh head: %s', r);
  commit;

  -- 3. A real race on one Salla order: A appends it and holds the lock; B's identical append (same
  --    head: ICV 3 after A-HASH-2) blocks until A commits, then sees the head moved; B's retry with the
  --    new head finds A's invoice for the order instead of issuing a second one.
  execute format('select public.zatca_append_invoice(%L::uuid, 3, %L, %L, %s)', c, 'A-HASH-2', 'sandbox', format(doc, 'A-3', 'A-HASH-3', 'c-race')) into a_first;
  assert a_first ->> 'outcome' = 'inserted', format('A race append: %s', a_first);
  perform dblink_send_query('zatca_b', format('select public.zatca_append_invoice(%L::uuid, 3, %L, %L, %s)::text',
    c, 'A-HASH-2', 'sandbox', format(doc, 'B-3', 'B-HASH-3', 'c-race')));
  perform pg_sleep(0.3);
  assert dblink_is_busy('zatca_b') = 1, 'session B must be waiting for A''s head-row lock';
  commit; -- A releases the lock
  while dblink_is_busy('zatca_b') = 1 and waited < 100 loop
    perform pg_sleep(0.05);
    waited := waited + 1;
  end loop;
  select t.r::jsonb into b_result from dblink_get_result('zatca_b') as t(r text);
  perform * from dblink_get_result('zatca_b') as t(r text); -- drain the end of the async result
  assert b_result ->> 'outcome' = 'head_moved' and (b_result ->> 'icv')::int = 4 and b_result ->> 'previous_hash' = 'A-HASH-3',
    format('B after waiting: %s', b_result);
  select t.r::jsonb into b_result from dblink('zatca_b', format('select public.zatca_append_invoice(%L::uuid, 4, %L, %L, %s)::text',
    c, 'A-HASH-3', 'sandbox', format(doc, 'B-3', 'B-HASH-4', 'c-race'))) as t(r text);
  assert b_result ->> 'outcome' = 'duplicate_order' and b_result ->> 'id' = a_first ->> 'id', format('B retry on the same order: %s', b_result);

  assert (select array_agg(icv order by icv) from public.invoices where merchant_id = c) = array[1, 2, 3], 'gap-free ICVs, one per document';
  assert (select array_agg(previous_invoice_hash order by icv) from public.invoices where merchant_id = c) = array[genesis, 'B-HASH-1', 'A-HASH-2'],
    'every document chains to the one before it';
  assert (select last_icv from public.zatca_chain_heads where merchant_id = c) = 3, 'head at the last document';
  perform dblink_disconnect('zatca_b');
end $$;

delete from public.invoices where merchant_id in ('00000000-0000-4000-8000-0000000045c2', '00000000-0000-4000-8000-0000000045d2');
delete from public.merchants where id in ('00000000-0000-4000-8000-0000000045c2', '00000000-0000-4000-8000-0000000045d2');
delete from auth.users where id in ('00000000-0000-4000-8000-0000000045c1', '00000000-0000-4000-8000-0000000045d1');
