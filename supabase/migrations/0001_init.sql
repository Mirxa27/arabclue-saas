-- arabclue · initial schema
-- Run: supabase db push

create extension if not exists "pgcrypto";

-- ── Merchants (Salla / direct) ───────────────────────────────────────────────
create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  salla_merchant_id text unique,
  salla_state text,
  store_url text,
  seller_name text,
  vat_number text,        -- 15 digits, ZATCA
  cr_number text,         -- 10 digits, MoCI
  seller_address jsonb,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  plan text default 'lite' check (plan in ('lite','plus','pro','enterprise')),
  installed_at timestamptz default now(),
  uninstalled_at timestamptz
);

create index if not exists merchants_salla_id_idx on merchants(salla_merchant_id);

-- ── Brand kits (used by social agent) ────────────────────────────────────────
create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  brand_name text not null,
  essence text,
  attributes text[] default '{}',
  favor_words text[] default '{}',
  avoid_words text[] default '{}',
  dialect text default 'khaliji' check (dialect in ('khaliji','msa','english')),
  updated_at timestamptz default now()
);

-- ── ZATCA Invoices ───────────────────────────────────────────────────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  salla_order_id text,
  invoice_number text not null,
  uuid uuid not null,
  icv int not null,
  invoice_hash text not null,
  qr_base64 text not null,
  xml text not null,
  subtotal numeric(14,2),
  vat numeric(14,2),
  total numeric(14,2),
  status text default 'generated' check (status in ('generated','submitted','cleared','rejected','failed')),
  fatoora_response jsonb,
  created_at timestamptz default now(),
  unique (merchant_id, icv)
);

create index if not exists invoices_merchant_idx on invoices(merchant_id, created_at desc);

-- ── Social media: planned + scheduled posts ──────────────────────────────────
create table if not exists social_plans (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  horizon_days int not null,
  generated_at timestamptz default now(),
  raw_plan jsonb not null  -- array of PlannedPost
);

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  plan_id uuid references social_plans(id) on delete set null,
  scheduled_for timestamptz not null,
  platforms text[] not null,
  goal text,
  hook text,
  copies jsonb not null,        -- {[platform]: Copy}
  visual_brief jsonb,
  status text default 'scheduled' check (status in ('scheduled','publishing','published','failed','canceled')),
  remote_ids jsonb default '{}'::jsonb,  -- {[platform]: remote_id}
  published_at timestamptz,
  error text
);

create index if not exists social_posts_due_idx on social_posts(scheduled_for) where status = 'scheduled';

-- ── Wathq cache ──────────────────────────────────────────────────────────────
create table if not exists wathq_cache (
  cr_number text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ── Generic event log ────────────────────────────────────────────────────────
create table if not exists events (
  id bigserial primary key,
  kind text not null,
  merchant text,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists events_kind_idx on events(kind, created_at desc);

-- ── Row Level Security baseline (tighten per app role layer) ─────────────────
alter table merchants enable row level security;
alter table brand_kits enable row level security;
alter table invoices enable row level security;
alter table social_plans enable row level security;
alter table social_posts enable row level security;

-- Service role bypasses RLS; user-scoped policies should be added once auth is in place.
