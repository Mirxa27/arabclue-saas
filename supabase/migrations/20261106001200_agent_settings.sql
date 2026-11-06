-- arabclue · persona agent settings (F13 / UI-007)
--
-- The dashboard "فريقك الذكي" toggles (social / voice / seo / sales / support / analyst
-- personas) used to be upserted into public.ai_employees with a persona_role/enabled
-- shape that table never had (0008 is the hired-employee marketplace table). Every
-- toggle failed and GET /api/agents/status crashed on marketplace rows. Persona agent
-- state now lives in its own table, one row per (merchant, persona).
--
-- Writes go through PATCH /api/agents/status and the OAuth callbacks on the service
-- role (the route checks the merchant's plan before enabling an agent); the owner can
-- read their rows. Re-runnable.

create table if not exists public.agent_settings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  persona_role text not null
    check (persona_role in ('social', 'voice', 'seo', 'sales', 'support', 'analyst')),
  enabled boolean not null default false,
  status text not null default 'idle'
    check (status in ('idle', 'active', 'paused', 'error', 'configuring')),
  last_error text,
  overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_settings_merchant_persona_key unique (merchant_id, persona_role),
  constraint agent_settings_overrides_object check (jsonb_typeof(overrides) = 'object')
);

drop trigger if exists agent_settings_set_updated_at on public.agent_settings;
create trigger agent_settings_set_updated_at
  before update on public.agent_settings
  for each row execute function public.set_updated_at();

alter table public.agent_settings enable row level security;

drop policy if exists "agent_settings_select_own" on public.agent_settings;
create policy "agent_settings_select_own" on public.agent_settings
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- Explicit grants (opt-in Data API grants; legacy projects auto-granted everything).
revoke all on table public.agent_settings from anon, authenticated;
grant select on table public.agent_settings to authenticated;
grant select, insert, update, delete on table public.agent_settings to service_role;

notify pgrst, 'reload schema';
