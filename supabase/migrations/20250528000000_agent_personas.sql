-- Migration: Agent Personas (rewritten)
--
-- History: the original version of this file re-declared public.ai_employees
-- with a persona shape (persona_role, enabled, ...) that conflicts with the
-- canonical table from 0008_ai_employees.sql. Because 0008 sorts first, its
-- `CREATE TABLE IF NOT EXISTS` was a no-op and the next statement
-- (an index on the non-existent `enabled` column) aborted the migration on
-- every database, blocking `supabase db push` for everything after it. It also
-- created two unused tables (oauth_connections with plaintext tokens,
-- agent_activity_log) and policies comparing auth.uid() with merchant_id.
--
-- The persona on/off settings now live in public.agent_settings (see the
-- 2026110600xxxx migrations). This file keeps only the shared updated_at
-- trigger function so the migration chain applies cleanly everywhere.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
