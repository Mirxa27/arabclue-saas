-- Minimal emulation of the objects a Supabase project provides before any
-- app migration runs, so supabase/migrations can be applied to a vanilla
-- PostgreSQL in CI and locally (scripts/db-test.sh). NOT applied to Supabase.
--
-- psql variable opt_in (scripts/db-test.sh sets it from DB_TEST_GRANTS):
--   off (default)  legacy Supabase defaults — API roles are auto-granted everything
--                  created in public
--   on             Supabase opt-in Data API grants (default for projects from
--                  2026-10-30): nothing is auto-granted, so migrations must grant
--                  every table/sequence/function they expose
\if :{?opt_in}
\else
  \set opt_in off
\endif

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

\if :opt_in
-- Opt-in model (supabase.com/docs/guides/api/securing-your-api): no automatic table,
-- sequence or function privileges for the API roles, and functions are not executable
-- by PUBLIC either.
alter default privileges in schema public revoke execute on functions from public;
\else
-- Supabase's (pre-2026-10-30) default privileges: API roles get table/sequence/function access
-- on everything created in public; RLS is what actually isolates tenants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
\endif

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- PostgREST sets request.jwt.claims per request; tests set it with set_config.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', current_user)
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
