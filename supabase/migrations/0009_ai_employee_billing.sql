-- arabclue · per-employee billing (Moyasar) after trial

alter table billing_payments
  drop constraint if exists billing_payments_plan_check;

alter table billing_payments
  add constraint billing_payments_plan_check
  check (plan in ('lite', 'plus', 'pro', 'employee'));

alter table ai_employees
  add column if not exists billing_status text not null default 'trial'
    check (billing_status in ('trial', 'active', 'past_due', 'canceled')),
  add column if not exists last_billing_payment_id uuid references billing_payments(id),
  add column if not exists next_billing_at timestamptz;

create index if not exists ai_employees_billing_status_idx
  on ai_employees(merchant_id, billing_status)
  where status = 'active';
