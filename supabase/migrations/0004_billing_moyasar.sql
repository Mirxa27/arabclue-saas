-- arabclue · Moyasar billing & subscriptions

alter table merchants
  add column if not exists subscription_status text default 'pending'
    check (subscription_status in ('pending', 'active', 'past_due', 'canceled')),
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists billing_cycle_started_at timestamptz;

create table if not exists billing_payments (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  moyasar_payment_id uuid unique,
  given_id uuid not null unique,
  plan text not null check (plan in ('lite', 'plus', 'pro')),
  amount_halalas integer not null,
  currency text not null default 'SAR',
  status text not null default 'pending'
    check (status in ('pending', 'initiated', 'paid', 'failed', 'refunded')),
  description text,
  metadata jsonb default '{}'::jsonb,
  moyasar_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists billing_payments_merchant_idx on billing_payments(merchant_id, created_at desc);
create index if not exists billing_payments_status_idx on billing_payments(status) where status in ('pending', 'initiated');

alter table billing_payments enable row level security;

create policy if not exists "billing_payments_self" on billing_payments
  for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));
