-- Pending Salla orders (20261106003600_pending_salla_orders.sql, RB-S3 / SW-2): orders of an
-- unlinked store are attached to the merchant that later owns the store, a batch is claimed
-- exactly once (FOR UPDATE SKIP LOCKED), and a crashed claim becomes claimable again.
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000047a1', 'pending-a@test.example');
insert into public.merchants (id, owner_user_id, seller_name, plan, salla_merchant_id) values
  ('00000000-0000-4000-8000-0000000047a2', '00000000-0000-4000-8000-0000000047a1', 'A', 'lite', 'store-47');

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-0000000047a2';
  n integer;
  claimed bigint[];
begin
  insert into public.pending_salla_orders (salla_store_id, salla_order_id, merchant_id, reason, order_payload, order_total, received_at) values
    ('store-47', 'o-1', null, 'store_unlinked', '{"id": 1}', 115, now() - interval '3 hours'),
    ('store-47', 'o-2', null, 'store_unlinked', '{"id": 2}', 230, now() - interval '2 hours'),
    ('store-other', 'o-9', null, 'store_unlinked', '{"id": 9}', 10, now() - interval '1 hour'),
    ('store-47', 'o-3', a, 'not_entitled', '{"id": 3}', 50, now() - interval '30 minutes');

  -- one row per (store, order): a redelivery cannot record the order twice
  begin
    insert into public.pending_salla_orders (salla_store_id, salla_order_id, reason, order_payload)
    values ('store-47', 'o-1', 'store_unlinked', '{}');
    assert false, 'duplicate (store, order) must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into public.pending_salla_orders (salla_store_id, salla_order_id, reason, order_payload) values ('store-47', 'o-x', 'because', '{}');
    assert false, 'unknown reasons must be refused';
  exception when check_violation then null;
  end;

  -- claiming for the store's merchant attaches its unlinked orders and returns the oldest first
  select array_agg(id order by received_at) into claimed from public.claim_pending_salla_orders(a, 'store-47', 2);
  assert array_length(claimed, 1) = 2, format('limit respected: %s', claimed);
  assert (select array_agg(salla_order_id order by received_at) from public.pending_salla_orders where id = any(claimed)) = array['o-1', 'o-2'],
    'oldest orders first';
  assert (select count(*) from public.pending_salla_orders where merchant_id = a) = 3, 'store rows attached to the merchant';
  assert (select merchant_id from public.pending_salla_orders where salla_order_id = 'o-9') is null, 'other stores untouched';
  assert (select bool_and(status = 'processing' and attempts = 1 and claimed_at is not null) from public.pending_salla_orders where id = any(claimed)),
    'claimed rows are processing';

  -- a second worker gets the rest, never the claimed rows
  select count(*) into n from public.claim_pending_salla_orders(a, 'store-47', 20) c where c.id = any(claimed);
  assert n = 0, 'claimed rows are not handed out twice';
  assert (select status from public.pending_salla_orders where salla_order_id = 'o-3') = 'processing', 'remaining row claimed by the second call';

  -- a claim older than 10 minutes (crashed worker) is claimable again
  update public.pending_salla_orders set claimed_at = now() - interval '11 minutes' where salla_order_id = 'o-1';
  select count(*) into n from public.claim_pending_salla_orders(a, null, 20) c where c.salla_order_id = 'o-1';
  assert n = 1, 'stale claim re-claimed';
  assert (select attempts from public.pending_salla_orders where salla_order_id = 'o-1') = 2, 'attempts counted';

  -- invoiced rows are never claimed again
  update public.pending_salla_orders set status = 'invoiced', processed_at = now() where merchant_id = a;
  select count(*) into n from public.claim_pending_salla_orders(a, 'store-47', 20);
  assert n = 0, 'nothing left to claim';

  begin
    perform public.claim_pending_salla_orders(null, 'store-47', 1);
    assert false, 'merchant id is required';
  exception when invalid_parameter_value then null;
  end;

  -- deleting the merchant deletes its pending orders (PDPL erasure)
  delete from public.merchants where id = a;
  assert not exists (select 1 from public.pending_salla_orders where salla_store_id = 'store-47'), 'cascade on merchant delete';
end $$;

rollback;
