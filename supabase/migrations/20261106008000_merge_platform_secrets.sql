-- Atomic merge for the admin-managed secrets blob (platform_settings key 'secrets').
--
-- savePlatformSecrets used to read the whole encrypted blob, change it in memory
-- and upsert it back. Two admins saving different config cards at the same time
-- (each card PATCHes separately) both got "updated", but the second write
-- silently dropped the first one's keys. This function applies the change in one
-- statement: set keys are merged in, removed keys deleted, and the row is created
-- if it does not exist yet (0005 seeds only 'agents' and 'features').
-- Note: jsonb `-` binds tighter than `||`, hence the explicit parentheses.
create or replace function public.merge_platform_secrets(p_set jsonb, p_remove text[])
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.platform_settings as ps (key, value, updated_at)
  values ('secrets', coalesce(p_set, '{}'::jsonb) - coalesce(p_remove, '{}'::text[]), now())
  on conflict (key) do update
    set value = (coalesce(ps.value, '{}'::jsonb) || excluded.value) - coalesce(p_remove, '{}'::text[]),
        updated_at = now();
$$;

revoke execute on function public.merge_platform_secrets(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.merge_platform_secrets(jsonb, text[]) to service_role;
