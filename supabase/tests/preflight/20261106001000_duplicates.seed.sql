-- Rows a production database can contain before 20261106001000 (no uniqueness on
-- routing keys; /welcome re-runs inserted a new brand kit each time; FOR ALL policies
-- let merchants copy each other's phone numbers / channel ids).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f001', 'dup-owner@example.test'),
  ('00000000-0000-4000-8000-00000000f002', 'other@example.test');

insert into public.merchants (id, owner_user_id, seller_name) values
  -- one user owning two merchant rows (double-submitted onboarding)
  ('00000000-0000-4000-8000-00000000f101', '00000000-0000-4000-8000-00000000f001', 'Dup 1'),
  ('00000000-0000-4000-8000-00000000f102', '00000000-0000-4000-8000-00000000f001', 'Dup 2'),
  ('00000000-0000-4000-8000-00000000f103', '00000000-0000-4000-8000-00000000f002', 'Victim');

-- three onboarding runs for the same merchant; the newest must survive
insert into public.brand_kits (id, merchant_id, brand_name, essence, updated_at) values
  ('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f103', 'Kit', 'oldest', now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f103', 'Kit', 'newest', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f103', 'Kit', 'middle', now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000000f204', '00000000-0000-4000-8000-00000000f101', 'Only kit', 'single', now());

-- a squatted phone number and a squatted Instagram account id
insert into public.voice_configs (merchant_id, phone_number) values
  ('00000000-0000-4000-8000-00000000f103', '+966500000777'),
  ('00000000-0000-4000-8000-00000000f101', '+966500000777');
insert into public.social_channels (merchant_id, platform, external_id) values
  ('00000000-0000-4000-8000-00000000f103', 'instagram', 'ig-victim'),
  ('00000000-0000-4000-8000-00000000f101', 'instagram', 'ig-victim');
