-- arabclue · voice, bookings, seo content
-- Run: supabase db push

-- ── Voice agent config (Module 03) ───────────────────────────────────────────
create table if not exists voice_configs (
  merchant_id uuid primary key references merchants(id) on delete cascade,
  dialect text default 'khaliji' check (dialect in ('khaliji','msa')),
  hours text,
  escalation_phone text,
  knowledge text,
  phone_number text,            -- provisioned STC/Twilio number
  enabled boolean default false,
  updated_at timestamptz default now()
);

-- ── Bookings captured by the voice agent ─────────────────────────────────────
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  name text not null,
  mobile text not null,
  preferred_time text,
  note text,
  source text default 'voice' check (source in ('voice','social','web')),
  status text default 'new' check (status in ('new','confirmed','done','canceled')),
  created_at timestamptz default now()
);
create index if not exists bookings_merchant_idx on bookings(merchant_id, created_at desc);

-- ── SEO / product copy outputs (Module 04) ───────────────────────────────────
create table if not exists seo_content (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade,
  kind text not null check (kind in ('product','blog','meta')),
  ref_id text,                  -- product id or slug
  payload jsonb not null,
  published boolean default false,
  created_at timestamptz default now()
);
create index if not exists seo_content_merchant_idx on seo_content(merchant_id, kind, created_at desc);

alter table voice_configs enable row level security;
alter table bookings enable row level security;
alter table seo_content enable row level security;
