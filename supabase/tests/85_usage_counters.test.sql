-- SW-25 / SW-26 (20261106007500_seo_audits_and_usage.sql): per-merchant usage quotas are a
-- service-role-only counter with an atomic claim that never exceeds the limit, and a release
-- that gives one unit back. Fixtures are rolled back at the end.

-- ── privileges ────────────────────────────────────────────────────────────────
do $$
declare
  p text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.merchant_usage_counters'::regclass), 'RLS must be on for merchant_usage_counters';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'merchant_usage_counters'), 'service-role only: no policies';
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('anon', 'public.merchant_usage_counters', p), format('anon must not have %s on merchant_usage_counters', p);
    assert not has_table_privilege('authenticated', 'public.merchant_usage_counters', p), format('authenticated must not have %s on merchant_usage_counters', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert has_table_privilege('service_role', 'public.merchant_usage_counters', p), format('service_role needs %s on merchant_usage_counters', p);
  end loop;
  assert not has_function_privilege('anon', 'public.claim_merchant_usage(uuid,text,date,integer)', 'execute'), 'anon must not claim usage';
  assert not has_function_privilege('authenticated', 'public.claim_merchant_usage(uuid,text,date,integer)', 'execute'), 'authenticated must not claim usage';
  assert has_function_privilege('service_role', 'public.claim_merchant_usage(uuid,text,date,integer)', 'execute'), 'service_role claims usage';
  assert not has_function_privilege('anon', 'public.release_merchant_usage(uuid,text,date)', 'execute'), 'anon must not release usage';
  assert not has_function_privilege('authenticated', 'public.release_merchant_usage(uuid,text,date)', 'execute'), 'authenticated must not release usage';
  assert has_function_privilege('service_role', 'public.release_merchant_usage(uuid,text,date)', 'execute'), 'service_role releases usage';
end $$;

begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000085a1', 'usage-a@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status)
values ('00000000-0000-4000-8000-0000000085a2', '00000000-0000-4000-8000-0000000085a1', 'Usage A', 'plus', 'active');

do $$
declare
  m constant uuid := '00000000-0000-4000-8000-0000000085a2';
  r jsonb;
  n integer;
begin
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-11-01', 2);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 1, format('first claim: %s', r);
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-11-01', 2);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 2, format('second claim: %s', r);
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-11-01', 2);
  assert not (r->>'allowed')::boolean and (r->>'used')::int = 2 and (r->>'limit')::int = 2, format('over the limit: %s', r);
  assert (select used from public.merchant_usage_counters where merchant_id = m and metric = 'seo.generation' and period_start = '2026-11-01') = 2,
    'a refused claim takes nothing';

  -- a lower limit (plan downgrade) refuses without touching the counter
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-11-01', 1);
  assert not (r->>'allowed')::boolean and (r->>'used')::int = 2, format('downgraded limit: %s', r);

  -- release gives one unit back, never below zero
  n := public.release_merchant_usage(m, 'seo.generation', '2026-11-01');
  assert n = 1, format('release: expected 1, got %s', n);
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-11-01', 2);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 2, format('claim after release: %s', r);
  perform public.release_merchant_usage(m, 'seo.generation', '2026-11-01');
  perform public.release_merchant_usage(m, 'seo.generation', '2026-11-01');
  n := public.release_merchant_usage(m, 'seo.generation', '2026-11-01');
  assert n is null, format('release at zero must do nothing, got %s', n);
  assert (select used from public.merchant_usage_counters where merchant_id = m and metric = 'seo.generation' and period_start = '2026-11-01') = 0,
    'used never goes below zero';

  -- periods and metrics are independent; a zero limit (plan without the module) refuses
  r := public.claim_merchant_usage(m, 'seo.generation', '2026-12-01', 2);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 1, format('new month: %s', r);
  r := public.claim_merchant_usage(m, 'wathq.lookup', '2026-11-06', 500);
  assert (r->>'allowed')::boolean and (r->>'used')::int = 1, format('other metric: %s', r);
  r := public.claim_merchant_usage(m, 'seo.audit', '2026-11-06', 0);
  assert not (r->>'allowed')::boolean and (r->>'used')::int = 0, format('zero limit: %s', r);
  assert not exists (select 1 from public.merchant_usage_counters where merchant_id = m and metric = 'seo.audit'), 'a zero limit creates no row';

  -- unknown metrics and missing arguments are rejected
  begin
    perform public.claim_merchant_usage(m, 'made.up', '2026-11-06', 5);
    assert false, 'unknown metric must be rejected';
  exception when check_violation then null;
  end;
  begin
    perform public.claim_merchant_usage(null, 'seo.audit', '2026-11-06', 5);
    assert false, 'a null merchant must be rejected';
  exception when null_value_not_allowed then null;
  end;

  -- counters go with the merchant
  delete from public.merchants where id = m;
  assert not exists (select 1 from public.merchant_usage_counters where merchant_id = m), 'counters cascade with the merchant';
end $$;

rollback;
