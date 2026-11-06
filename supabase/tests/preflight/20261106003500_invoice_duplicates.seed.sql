-- critic-24 pre-flight: Salla-order invoice duplicates left behind by the F08/F09 webhook races,
-- seeded before 20261106003500_zatca_phase2.sql adds the one-live-invoice-per-order index.
--   merchant f201, order dup-unreported: generated (earliest) + failed + rejected — nothing reached ZATCA
--   merchant f201, order dup-reported:   cleared (earliest) + cleared — both already sent to ZATCA
--   merchant f202, order single:         one invoice — untouched
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f201', 'dup-a@test.example'),
  ('00000000-0000-4000-8000-00000000f202', 'dup-b@test.example');
insert into public.merchants (id, owner_user_id, seller_name, plan) values
  ('00000000-0000-4000-8000-00000000f211', '00000000-0000-4000-8000-00000000f201', 'Dup A', 'lite'),
  ('00000000-0000-4000-8000-00000000f212', '00000000-0000-4000-8000-00000000f202', 'Dup B', 'lite');

insert into public.invoices (merchant_id, salla_order_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml, status, created_at) values
  ('00000000-0000-4000-8000-00000000f211', 'dup-unreported', 'INV-U1', gen_random_uuid(), 1, 'h1', 'q', '<x/>', 'generated', now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000f211', 'dup-unreported', 'INV-U2', gen_random_uuid(), 2, 'h2', 'q', '<x/>', 'failed',    now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000000f211', 'dup-unreported', 'INV-U3', gen_random_uuid(), 3, 'h3', 'q', '<x/>', 'rejected',  now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000f211', 'dup-reported',   'INV-R1', gen_random_uuid(), 4, 'h4', 'q', '<x/>', 'cleared',   now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000f211', 'dup-reported',   'INV-R2', gen_random_uuid(), 5, 'h5', 'q', '<x/>', 'cleared',   now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000000f212', 'single',         'INV-S1', gen_random_uuid(), 1, 'h6', 'q', '<x/>', 'cleared',   now() - interval '1 day');
-- the old flow could set zatca_onboarded_at without arabclue holding a signing key
update public.merchants set zatca_onboarded_at = now() where id = '00000000-0000-4000-8000-00000000f211';
