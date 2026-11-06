-- arabclue · redact Salla credentials already stored in public.events (RB-S4)
--
-- Before the Salla connect stream, POST /api/salla/webhook logged deliveries verbatim:
-- events(kind = evt.event, merchant = '<store id>', payload = evt) in its default branch and
-- kind 'salla.installed' for app.installed. Every app.store.authorize delivery therefore stored
-- data.access_token and data.refresh_token in plaintext, and admin_search_events /
-- GET /api/admin/events still serve them (`?kind=app.store.authorize`). A Salla refresh token
-- stays valid for a month and each use yields a new pair, so whoever uses one first keeps the
-- store. New writes go through stripSallaSecrets (lib/salla/app-events.ts); this migration removes
-- the same keys from the rows already stored.
--
-- salla_strip_secrets(jsonb) mirrors stripSallaSecrets: drops object keys named access_token,
-- refresh_token, id_token, token, client_secret, secret, password or authorization (any letter
-- case) at any depth; values nested deeper than 32 levels become null. Only Salla webhook rows
-- are rewritten: a {event, merchant, …} envelope logged under kind = payload.event, and the
-- 'salla.*' kinds — other event kinds are left exactly as they are.
--
-- The tokens are not recoverable afterwards: an Easy Mode install made before this deploy
-- reconnects when the store authorizes the app again (reinstall) or connects from Integrations.
-- Re-runnable (a no-op once clean).

create or replace function public.salla_strip_secrets(p_value jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out jsonb;
  v_key text;
  v_item jsonb;
begin
  if p_value is null then
    return null;
  end if;
  if p_depth > 32 then
    return 'null'::jsonb;
  end if;
  case jsonb_typeof(p_value)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_key, v_item in select o.key, o.value from jsonb_each(p_value) as o loop
        if lower(v_key) not in ('access_token', 'refresh_token', 'id_token', 'token', 'client_secret', 'secret', 'password', 'authorization') then
          v_out := v_out || jsonb_build_object(v_key, public.salla_strip_secrets(v_item, p_depth + 1));
        end if;
      end loop;
      return v_out;
    when 'array' then
      select coalesce(jsonb_agg(public.salla_strip_secrets(a.elem, p_depth + 1) order by a.ord), '[]'::jsonb)
        into v_out
        from jsonb_array_elements(p_value) with ordinality as a(elem, ord);
      return v_out;
    else
      return p_value;
  end case;
end;
$$;

revoke execute on function public.salla_strip_secrets(jsonb, integer) from public, anon, authenticated;
grant execute on function public.salla_strip_secrets(jsonb, integer) to service_role;

-- Candidates: Salla rows whose text form names a credential key (cheap pre-filter); the update
-- only writes rows the strip actually changes.
with candidates as (
  select e.id
    from public.events e
   where e.payload is not null
     and (
       e.kind like 'salla.%'
       or (jsonb_typeof(e.payload) = 'object' and e.payload ? 'event' and e.payload ? 'merchant'
           and e.kind = e.payload ->> 'event')
     )
     and e.payload::text ~* '"(access_token|refresh_token|id_token|token|client_secret|secret|password|authorization)":'
)
update public.events e
   set payload = public.salla_strip_secrets(e.payload)
  from candidates c
 where e.id = c.id
   and e.payload is distinct from public.salla_strip_secrets(e.payload);
