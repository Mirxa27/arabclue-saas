-- arabclue · Salla orders that cannot be invoiced yet (RB-S3, SW-2)
--
-- An order.created is never acknowledged-and-dropped any more. When it cannot be invoiced right now
-- it is recorded here, keyed by the Salla store id, and invoiced later by
-- lib/invoices/pending-orders.ts (after ZATCA onboarding, on the next order of the store, from the
-- invoices page, and by the /api/zatca/sweep cron):
--   store_unlinked        the store is installed but not claimed/linked, or was disconnected
--   not_entitled          the merchant has no active (or past-due grace) subscription with ZATCA
--   zatca_disabled        the platform's features.zatca kill switch is off
--   zatca_not_configured  the deployment has no ZATCA environment configured
--   zatca_not_onboarded   the merchant has not finished ZATCA onboarding (no signing key yet)
--   issue_failed          issuing failed for a reason that a retry may fix
-- The order is stored minimised: what the invoice needs (items, amounts, date, buyer name) — no
-- customer e-mail, phone or address. Unlinked rows are pruned after 30 days (the Easy Mode claim
-- window); rows of a merchant are deleted with the merchant.
--
-- Service role only: RLS on, no policies, no grants for anon/authenticated.
--
-- claim_pending_salla_orders(merchant, store, limit) attaches the store's unlinked rows to the
-- merchant that now owns the store and claims a batch for processing (FOR UPDATE SKIP LOCKED, a
-- 'processing' claim older than 10 minutes is stale), so concurrent workers never invoice the same
-- order twice (the live-invoice-per-order unique index is the backstop). Re-runnable.

create table if not exists public.pending_salla_orders (
  id bigserial primary key,
  salla_store_id text not null,
  salla_order_id text not null,
  merchant_id uuid references public.merchants(id) on delete cascade,
  reason text not null,
  order_payload jsonb not null,
  order_total numeric(14, 2),
  order_date timestamptz,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  invoice_id uuid references public.invoices(id) on delete set null,
  claimed_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pending_salla_orders_store_order_key unique (salla_store_id, salla_order_id),
  constraint pending_salla_orders_ids_not_blank check (btrim(salla_store_id) <> '' and btrim(salla_order_id) <> ''),
  constraint pending_salla_orders_reason check (
    reason in ('store_unlinked', 'not_entitled', 'zatca_disabled', 'zatca_not_configured', 'zatca_not_onboarded', 'issue_failed')
  ),
  constraint pending_salla_orders_status check (status in ('pending', 'processing', 'invoiced', 'unmappable'))
);

create index if not exists pending_salla_orders_merchant_idx
  on public.pending_salla_orders (merchant_id, status, received_at);
create index if not exists pending_salla_orders_unlinked_idx
  on public.pending_salla_orders (salla_store_id, received_at) where merchant_id is null;

alter table public.pending_salla_orders enable row level security;
revoke all on table public.pending_salla_orders from anon, authenticated;
revoke all on sequence public.pending_salla_orders_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.pending_salla_orders to service_role;
grant usage, select on sequence public.pending_salla_orders_id_seq to service_role;

drop trigger if exists pending_salla_orders_set_updated_at on public.pending_salla_orders;
create trigger pending_salla_orders_set_updated_at
  before update on public.pending_salla_orders
  for each row execute function public.set_updated_at();

create or replace function public.claim_pending_salla_orders(
  p_merchant_id uuid,
  p_store_id text,
  p_limit integer default 20
) returns setof public.pending_salla_orders
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_merchant_id is null then
    raise exception 'claim_pending_salla_orders: merchant id required' using errcode = '22023';
  end if;
  -- Orders that arrived while the store was not linked now belong to the merchant that owns it.
  if p_store_id is not null and btrim(p_store_id) <> '' then
    update public.pending_salla_orders
    set merchant_id = p_merchant_id
    where merchant_id is null and salla_store_id = p_store_id;
  end if;

  return query
  with batch as (
    select o.id
    from public.pending_salla_orders o
    where o.merchant_id = p_merchant_id
      and (o.status = 'pending' or (o.status = 'processing' and o.claimed_at < now() - interval '10 minutes'))
    order by o.received_at, o.id
    limit greatest(1, least(coalesce(p_limit, 20), 200))
    for update skip locked
  )
  update public.pending_salla_orders o
  set status = 'processing', claimed_at = now(), attempts = o.attempts + 1
  from batch
  where o.id = batch.id
  returning o.*;
end;
$$;

revoke execute on function public.claim_pending_salla_orders(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_salla_orders(uuid, text, integer) to service_role;

notify pgrst, 'reload schema';
