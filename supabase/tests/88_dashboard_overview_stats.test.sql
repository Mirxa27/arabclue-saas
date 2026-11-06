-- UI-011 (20261106007600_notifications_and_overview.sql): the overview KPIs are exact and
-- scoped — month-to-date is the Asia/Riyadh calendar month, counts are not capped, rejected
-- invoices are not "invoiced", and another merchant's id yields zeros through RLS.
-- Fixtures are rolled back at the end. "Now" is pinned to 2026-11-06 12:00 UTC.

do $$
begin
  assert not has_function_privilege('anon', 'public.dashboard_overview_stats(uuid,timestamptz)', 'execute'), 'anon must not read stats';
  assert has_function_privilege('authenticated', 'public.dashboard_overview_stats(uuid,timestamptz)', 'execute'), 'owners read their stats';
  assert has_function_privilege('service_role', 'public.dashboard_overview_stats(uuid,timestamptz)', 'execute'), 'service_role reads stats';
  assert (select prosecdef from pg_proc where oid = 'public.dashboard_overview_stats(uuid,timestamptz)'::regprocedure) = false,
    'stats run as the caller (security invoker) so RLS applies';
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000088a1', 'kpi-a@example.test'),
  ('00000000-0000-4000-8000-0000000088b1', 'kpi-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-0000000088a2', '00000000-0000-4000-8000-0000000088a1', 'KPI A', 'plus', 'active'),
  ('00000000-0000-4000-8000-0000000088b2', '00000000-0000-4000-8000-0000000088b1', 'KPI B', 'plus', 'active');

-- A: 7 invoices. In November (Riyadh): 100 cleared, 50 generated, 999 rejected, and 20 created at
-- 2026-10-31 21:30 UTC = 2026-11-01 00:30 Riyadh. 30 at 2026-10-31 20:30 UTC = 23:30 Riyadh (October).
-- 40 cleared 20 days ago (inside 30 days, October), 60 cleared 45 days ago (outside 30 days).
insert into public.invoices (merchant_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml, total, status, created_at) values
  ('00000000-0000-4000-8000-0000000088a2', 'A-1', gen_random_uuid(), 1, 'h1', 'qr', '<x/>', 100, 'cleared',   '2026-11-05 10:00:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-2', gen_random_uuid(), 2, 'h2', 'qr', '<x/>', 50,  'generated', '2026-11-04 10:00:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-3', gen_random_uuid(), 3, 'h3', 'qr', '<x/>', 999, 'rejected',  '2026-11-03 10:00:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-4', gen_random_uuid(), 4, 'h4', 'qr', '<x/>', 20,  'cleared',   '2026-10-31 21:30:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-5', gen_random_uuid(), 5, 'h5', 'qr', '<x/>', 30,  'cleared',   '2026-10-31 20:30:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-6', gen_random_uuid(), 6, 'h6', 'qr', '<x/>', 40,  'cleared',   '2026-10-17 12:00:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'A-7', gen_random_uuid(), 7, 'h7', 'qr', '<x/>', 60,  'cleared',   '2026-09-22 12:00:00+00'),
  ('00000000-0000-4000-8000-0000000088b2', 'B-1', gen_random_uuid(), 1, 'hb', 'qr', '<x/>', 5000, 'cleared',  '2026-11-05 10:00:00+00');

-- ZATCA Phase 2 (when its migration is present) adds 'reported' = an ACCEPTED simplified invoice:
-- it must count as accepted and invoiced. On a schema without that status the row is skipped.
do $$
begin
  insert into public.invoices (merchant_id, invoice_number, uuid, icv, invoice_hash, qr_base64, xml, total, status, created_at)
  values ('00000000-0000-4000-8000-0000000088a2', 'A-8', gen_random_uuid(), 8, 'h8', 'qr', '<x/>', 10, 'reported', '2026-11-05 12:00:00+00');
exception when check_violation or not_null_violation then
  null;
end $$;

insert into public.social_posts (merchant_id, scheduled_for, platforms, hook, copies, status, published_at) values
  ('00000000-0000-4000-8000-0000000088a2', '2026-11-08 10:00:00+00', '{instagram}', 'next week', '{}', 'scheduled', null),
  ('00000000-0000-4000-8000-0000000088a2', '2026-11-09 10:00:00+00', '{x}',         'later',     '{}', 'scheduled', null),
  ('00000000-0000-4000-8000-0000000088a2', '2026-11-02 10:00:00+00', '{instagram}', 'posted',    '{}', 'published', '2026-11-02 10:00:05+00'),
  ('00000000-0000-4000-8000-0000000088a2', '2026-11-03 10:00:00+00', '{tiktok}',    'broke',     '{}', 'failed',    null),
  ('00000000-0000-4000-8000-0000000088a2', '2026-08-01 10:00:00+00', '{instagram}', 'old',       '{}', 'published', '2026-08-01 10:00:05+00');

insert into public.bookings (merchant_id, name, mobile, source, created_at) values
  ('00000000-0000-4000-8000-0000000088a2', 'Caller 1', '+966500000001', 'voice', '2026-11-05 09:00:00+00'),
  ('00000000-0000-4000-8000-0000000088a2', 'Caller 2', '+966500000002', 'voice', '2026-08-05 09:00:00+00');

insert into public.agent_settings (merchant_id, persona_role, enabled, status) values
  ('00000000-0000-4000-8000-0000000088a2', 'social', true, 'active'),
  ('00000000-0000-4000-8000-0000000088a2', 'voice', true, 'active'),
  ('00000000-0000-4000-8000-0000000088a2', 'seo', false, 'idle');

insert into public.ai_employees (id, merchant_id, role_id, display_name, status) values
  ('00000000-0000-4000-8000-0000000088a3', '00000000-0000-4000-8000-0000000088a2', 'sales-rep', 'Layla', 'active'),
  ('00000000-0000-4000-8000-0000000088a4', '00000000-0000-4000-8000-0000000088a2', 'sales-rep', 'Omar', 'paused');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000088a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
declare
  s jsonb := public.dashboard_overview_stats('00000000-0000-4000-8000-0000000088a2', '2026-11-06 12:00:00+00');
  other jsonb := public.dashboard_overview_stats('00000000-0000-4000-8000-0000000088b2', '2026-11-06 12:00:00+00');
  r integer := (select count(*) from public.invoices where status = 'reported');  -- 1 with ZATCA Phase 2, else 0
begin
  assert (s->>'month_start')::timestamptz = '2026-10-31 21:00:00+00', format('Riyadh month start, got %s', s->>'month_start');
  assert (s->>'mtd_total')::numeric = 170 + 10 * r, format('MTD = 100 + 50 + 20 (+10 reported; rejected and October excluded), got %s', s->>'mtd_total');
  assert (s->>'mtd_count')::int = 3 + r, format('MTD count, got %s', s->>'mtd_count');
  assert (s->>'invoices_total')::int = 7 + r, format('all-time invoices are not capped, got %s', s->>'invoices_total');
  assert (s->>'invoices_30d')::int = 6 + r, format('30-day invoices, got %s', s->>'invoices_30d');
  assert (s->>'accepted_30d')::int = 4 + r, format('30-day accepted (cleared + reported), got %s', s->>'accepted_30d');
  assert (s->>'submitted_30d')::int = 5 + r, format('30-day submitted (accepted + rejected), got %s', s->>'submitted_30d');
  assert (s->>'rejected_30d')::int = 1, format('30-day rejected, got %s', s->>'rejected_30d');
  assert (s->>'posts_scheduled')::int = 2, format('scheduled posts, got %s', s->>'posts_scheduled');
  assert (s->>'posts_published_30d')::int = 1, format('published in 30 days, got %s', s->>'posts_published_30d');
  assert (s->>'posts_failed_30d')::int = 1, format('failed in 30 days, got %s', s->>'posts_failed_30d');
  assert (s->>'bookings_30d')::int = 1, format('bookings in 30 days, got %s', s->>'bookings_30d');
  assert (s->>'agents_enabled')::int = 2, format('enabled agents, got %s', s->>'agents_enabled');
  assert (s->>'employees_active')::int = 1, format('active employees, got %s', s->>'employees_active');

  -- another merchant's id: RLS hides every row, so all zeros (never B's 5000)
  assert (other->>'mtd_total')::numeric = 0, format('foreign merchant MTD must be 0, got %s', other->>'mtd_total');
  assert (other->>'invoices_total')::int = 0, format('foreign merchant invoices must be 0, got %s', other->>'invoices_total');
end $$;

reset role;

-- an empty merchant gets zeros, not nulls
do $$
declare
  s jsonb := public.dashboard_overview_stats('00000000-0000-4000-8000-0000000088b2', '2026-12-15 12:00:00+00');
begin
  assert (s->>'mtd_total')::numeric = 0 and (s->>'mtd_count')::int = 0, format('no December invoices yet: %s', s);
  assert (s->>'posts_scheduled')::int = 0 and (s->>'agents_enabled')::int = 0 and (s->>'employees_active')::int = 0, format('empty counts: %s', s);
end $$;

rollback;
