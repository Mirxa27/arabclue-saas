-- F21 / UI-004 (20261106007500_seo_audits_and_usage.sql): SEO audit results are written by the
-- server only; a signed-in owner can read their own audits and nobody else's.
-- Fixtures are rolled back at the end.

do $$
declare
  p text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.seo_site_audits'::regclass), 'RLS must be on for seo_site_audits';
  assert has_table_privilege('authenticated', 'public.seo_site_audits', 'SELECT'), 'owners read their audits';
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    assert not has_table_privilege('authenticated', 'public.seo_site_audits', p), format('authenticated must not have %s on seo_site_audits', p);
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    assert not has_table_privilege('anon', 'public.seo_site_audits', p), format('anon must not have %s on seo_site_audits', p);
    assert has_table_privilege('service_role', 'public.seo_site_audits', p), format('service_role needs %s on seo_site_audits', p);
  end loop;
end $$;

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000086a1', 'audit-a@example.test'),
  ('00000000-0000-4000-8000-0000000086b1', 'audit-b@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-0000000086a2', '00000000-0000-4000-8000-0000000086a1', 'Audit A', 'plus', 'active'),
  ('00000000-0000-4000-8000-0000000086b2', '00000000-0000-4000-8000-0000000086b1', 'Audit B', 'plus', 'active');

insert into public.seo_site_audits (merchant_id, url, pages, issues, summary) values
  ('00000000-0000-4000-8000-0000000086a2', 'https://a.example/', '[{"url":"https://a.example/","kind":"home","ok":true}]',
   '[{"code":"title_missing","severity":"critical"}]', '{"critical":1,"warning":0,"info":0,"pages":1}'),
  ('00000000-0000-4000-8000-0000000086b2', 'https://b.example/', '[]', '[]', '{}');

-- shape constraints
do $$
begin
  begin
    insert into public.seo_site_audits (merchant_id, url, issues) values ('00000000-0000-4000-8000-0000000086a2', 'https://a.example/', '{"not":"an array"}');
    assert false, 'issues must be a JSON array';
  exception when check_violation then null;
  end;
  begin
    insert into public.seo_site_audits (merchant_id, url) values ('00000000-0000-4000-8000-0000000086a2', '');
    assert false, 'an empty url is rejected';
  exception when check_violation then null;
  end;
  -- worst realistic audit: 4 pages × 25 checks, 2 KB URLs, long Arabic evidence — must fit
  insert into public.seo_site_audits (merchant_id, url, issues)
  values ('00000000-0000-4000-8000-0000000086a2', 'https://a.example/',
          (select jsonb_agg(jsonb_build_object(
             'code', 'title_too_long', 'severity', 'warning', 'url', 'https://a.example/' || repeat('p', 2030),
             'title', jsonb_build_object('ar', repeat('ع', 80), 'en', repeat('t', 80)),
             'detail', jsonb_build_object('ar', repeat('ت', 300), 'en', repeat('d', 300)),
             'evidence', repeat('ك', 800)))
           from generate_series(1, 100)));
  begin
    insert into public.seo_site_audits (merchant_id, url, issues)
    values ('00000000-0000-4000-8000-0000000086a2', 'https://a.example/',
            (select jsonb_agg(jsonb_build_object('code', 'x', 'evidence',
               md5(g::text) || md5((g * 7)::text) || md5((g * 13)::text) || md5((g * 31)::text) ||
               md5((g * 61)::text) || md5((g * 97)::text) || md5((g * 127)::text) || md5((g * 251)::text)))
             from generate_series(1, 6000) g));
    assert false, 'oversized audits are rejected';
  exception when check_violation then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000086a1","role":"authenticated"}', true) as jwt_claims \gset

do $$
begin
  assert (select count(*) from public.seo_site_audits) = 2, 'owner A sees exactly their own two audits';
  assert not exists (select 1 from public.seo_site_audits where url <> 'https://a.example/'), 'and never B''s';
  begin
    insert into public.seo_site_audits (merchant_id, url) values ('00000000-0000-4000-8000-0000000086a2', 'https://forged.example/');
    assert false, 'owners cannot write audit results';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.seo_site_audits;
    assert false, 'owners cannot delete audit results';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
