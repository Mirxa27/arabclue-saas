-- NOTE: PostgreSQL has no CREATE POLICY IF NOT EXISTS; the original statements were
-- syntax errors that stopped fresh databases here. Rewritten as drop-if-exists + create
-- (same policies, re-runnable). Already-applied environments are unaffected.
-- arabclue · migration 0002
-- adds: user ↔ merchant linkage, Salla products, ZATCA CSID, social channels

-- ── user_id on merchants ────────────────────────────────────────────────────
alter table merchants
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists zatca_csid text,
  add column if not exists zatca_onboarded_at timestamptz,
  add column if not exists zatca_private_key_encrypted text;

create index if not exists merchants_owner_idx on merchants(owner_user_id);

-- ── Salla products mirror ───────────────────────────────────────────────────
create table if not exists salla_products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  salla_product_id text not null,
  name text not null,
  arabic_name text,
  description text,
  price numeric(14,2),
  category text,
  image_url text,
  url text,
  inventory int,
  updated_at timestamptz default now(),
  unique (merchant_id, salla_product_id)
);

create index if not exists salla_products_merchant_idx on salla_products(merchant_id);

-- ── Social channels (per merchant) ──────────────────────────────────────────
create table if not exists social_channels (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','x','snapchat','linkedin','whatsapp')),
  external_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  connected_at timestamptz default now(),
  unique (merchant_id, platform)
);

-- ── RLS policies for user-scoped access ─────────────────────────────────────
drop policy if exists "merchants_self" on merchants;
create policy "merchants_self" on merchants
  for all using (owner_user_id = auth.uid());

drop policy if exists "brand_kits_self" on brand_kits;
create policy "brand_kits_self" on brand_kits
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));

drop policy if exists "invoices_self" on invoices;
create policy "invoices_self" on invoices
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));

drop policy if exists "social_posts_self" on social_posts;
create policy "social_posts_self" on social_posts
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));

drop policy if exists "social_plans_self" on social_plans;
create policy "social_plans_self" on social_plans
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));

alter table salla_products enable row level security;
drop policy if exists "salla_products_self" on salla_products;
create policy "salla_products_self" on salla_products
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));

alter table social_channels enable row level security;
drop policy if exists "social_channels_self" on social_channels;
create policy "social_channels_self" on social_channels
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));
