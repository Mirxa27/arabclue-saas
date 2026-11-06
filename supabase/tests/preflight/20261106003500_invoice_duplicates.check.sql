-- After 20261106003500_zatca_phase2.sql ran on top of the duplicate invoices:
--  * nothing aborted and the one-live-invoice-per-order index exists
--  * the earliest invoice of each order stays live; later ones point at it (superseded_by)
--  * unreported extras are 'failed' (a rejected one stays rejected) with a "no action" note
--  * extras already sent to ZATCA keep their status (legal records) and say a credit note is needed
--  * nothing was deleted or renumbered; a re-run changes nothing
do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000f211';
  kept_u uuid;
  kept_r uuid;
begin
  assert to_regclass('public.invoices_merchant_salla_order_live_uidx') is not null, 'live-invoice index must exist';
  assert to_regclass('public.pending_salla_orders') is not null, 'later migrations must still apply';
  assert (select count(*) from public.invoices where merchant_id in (a, '00000000-0000-4000-8000-00000000f212')) = 6, 'no invoice deleted';
  assert (select array_agg(icv order by icv) from public.invoices where merchant_id = a) = array[1, 2, 3, 4, 5], 'no invoice renumbered';

  select id into kept_u from public.invoices where invoice_number = 'INV-U1';
  select id into kept_r from public.invoices where invoice_number = 'INV-R1';
  assert (select superseded_by from public.invoices where id = kept_u) is null, 'earliest unreported invoice stays live';
  assert (select status from public.invoices where id = kept_u) = 'generated', 'kept invoice untouched';
  assert (select superseded_by from public.invoices where invoice_number = 'INV-U2') = kept_u, 'U2 superseded by U1';
  assert (select status from public.invoices where invoice_number = 'INV-U2') = 'failed', 'unreported extra marked failed';
  assert (select status from public.invoices where invoice_number = 'INV-U3') = 'rejected', 'a rejected extra stays rejected';
  assert (select status_note from public.invoices where invoice_number = 'INV-U3') like '%no action needed%', 'unreported note';

  assert (select superseded_by from public.invoices where id = kept_r) is null, 'earliest reported invoice stays live';
  assert (select superseded_by from public.invoices where invoice_number = 'INV-R2') = kept_r, 'R2 superseded by R1';
  assert (select status from public.invoices where invoice_number = 'INV-R2') = 'cleared', 'a reported duplicate keeps its status';
  assert (select status_note from public.invoices where invoice_number = 'INV-R2') like '%credit note%', 'reported duplicate needs a credit note';

  assert (select superseded_by from public.invoices where invoice_number = 'INV-S1') is null, 'single invoices untouched';
  assert (select status_note from public.invoices where invoice_number = 'INV-S1') is null, 'single invoices get no note';

  assert (select zatca_onboarded_at from public.merchants where id = a) is null, 'onboarded flag without an EGS key is cleared';
end $$;

\ir ../../migrations/20261106003500_zatca_phase2.sql

do $$
begin
  assert (select count(*) from public.invoices where superseded_by is not null) = 3, 're-run must not supersede anything else';
  assert (select status from public.invoices where invoice_number = 'INV-U1') = 'generated', 're-run keeps the live invoice';
end $$;
