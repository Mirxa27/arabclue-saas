-- arabclue · Salla app lifecycle in Salla's event order (RB-S2)
--
-- app.uninstalled had no ordering guard: markSallaStoreUninstalled always wiped the store's
-- tokens. A retried or late uninstall (Salla redelivers a failed webhook ~5 minutes later, up to
-- three times; a crashed handler's claim goes stale after 300 s) therefore wiped the tokens of a
-- NEWER reinstall — the app is installed in Salla but arabclue says "Connect Salla", and Easy Mode
-- does not resend app.store.authorize. Conversely an older app.store.authorize redelivered after a
-- processed uninstall re-applied revoked tokens (the expiry check only compares authorizations).
--
-- 1. salla_store_lifecycle (per Salla store, linked or not): the event time of the newest applied
--    authorization and of the newest applied uninstall. Event times are Salla's `created_at`
--    (lib/salla/app-events.ts sallaEventTime); a Custom Mode OAuth link counts as an
--    authorization at link time. Service role only.
-- 2. salla_record_uninstall(store, event_at): under the per-store advisory lock, ignores an
--    uninstall older than the stored authorization ('stale'); otherwise clears the linked
--    merchant's tokens, drops a parked install and records the uninstall — one transaction
--    (it used to be two separate writes from the app).
-- 3. salla_apply_authorization(…, event_at, …): salla_record_authorization plus the ordering: an
--    authorization older than an applied uninstall is 'stale'; an applied one records its time.
--    salla_record_authorization keeps its signature (event time unknown → unordered, as before).
-- 4. salla_link_store (Custom Mode callback) records its authorization time; salla_claim_install
--    links a parked authorization without moving it (that authorization's own time stays).
--
-- A null event time (no created_at) keeps the previous, unordered behaviour. Re-runnable.

create table if not exists public.salla_store_lifecycle (
  salla_merchant_id text primary key,
  authorized_event_at timestamptz,
  uninstalled_event_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint salla_store_lifecycle_store_not_blank check (btrim(salla_merchant_id) <> '')
);

alter table public.salla_store_lifecycle enable row level security;
revoke all on table public.salla_store_lifecycle from anon, authenticated;
grant select, insert, update, delete on table public.salla_store_lifecycle to service_role;

-- Best-effort starting point for stores that exist today (installed_at is set on link; a row
-- whose tokens are gone was uninstalled or disconnected at uninstalled_at).
insert into public.salla_store_lifecycle (salla_merchant_id, authorized_event_at, uninstalled_event_at)
select m.salla_merchant_id,
       case when m.access_token is not null then m.installed_at end,
       case when m.access_token is null then m.uninstalled_at end
  from public.merchants m
 where nullif(btrim(m.salla_merchant_id), '') is not null
on conflict (salla_merchant_id) do nothing;

insert into public.salla_store_lifecycle (salla_merchant_id, authorized_event_at)
select i.salla_merchant_id, i.authorized_at from public.salla_installs i
on conflict (salla_merchant_id) do nothing;

-- ── internal: record an applied authorization / uninstall (caller holds the store lock) ──
create or replace function public.salla_lifecycle_note(p_store text, p_authorized_at timestamptz, p_uninstalled_at timestamptz)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.salla_store_lifecycle as c (salla_merchant_id, authorized_event_at, uninstalled_event_at, updated_at)
  values (p_store, p_authorized_at, p_uninstalled_at, now())
  on conflict (salla_merchant_id) do update
     set authorized_event_at = greatest(c.authorized_event_at, excluded.authorized_event_at),
         uninstalled_event_at = greatest(c.uninstalled_event_at, excluded.uninstalled_event_at),
         updated_at = now();
$$;

-- ── salla_link_store_at: salla_link_store with the authorization time to record ──
-- Outcomes as salla_link_store. p_authorized_at null = do not touch the lifecycle (claims).
create or replace function public.salla_link_store_at(
  p_merchant_id uuid,
  p_salla_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_store_name text,
  p_authorized_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_store text := nullif(btrim(p_salla_merchant_id), '');
  v_name text := nullif(btrim(p_store_name), '');
begin
  if p_merchant_id is null or v_store is null or nullif(p_access_token, '') is null then
    raise exception 'salla_link_store: merchant, store and access token are required' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('arabclue:salla_store:' || v_store, 0));

  if exists (select 1 from public.merchants where salla_merchant_id = v_store and id <> p_merchant_id) then
    return jsonb_build_object('outcome', 'store_already_linked');
  end if;

  perform 1 from public.merchants where id = p_merchant_id for update;
  if not found then
    return jsonb_build_object('outcome', 'merchant_not_found');
  end if;

  update public.merchants
     set salla_merchant_id = v_store,
         access_token = p_access_token,
         refresh_token = p_refresh_token,
         token_expires_at = p_expires_at,
         salla_store_name = coalesce(v_name, salla_store_name),
         seller_name = coalesce(nullif(btrim(seller_name), ''), v_name),
         salla_refresh_lease = null,
         salla_refresh_lease_until = null,
         salla_token_invalid_at = null,
         installed_at = now(),
         uninstalled_at = null
   where id = p_merchant_id;

  -- the merchant's own tokens supersede any parked Easy Mode authorization for this store
  delete from public.salla_installs where salla_merchant_id = v_store;

  if p_authorized_at is not null then
    perform public.salla_lifecycle_note(v_store, p_authorized_at, null);
  end if;

  return jsonb_build_object('outcome', 'linked', 'merchant_id', p_merchant_id, 'salla_merchant_id', v_store);
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'store_already_linked');
end;
$$;

-- ── salla_link_store: Custom Mode callback — an authorization happening now ──
create or replace function public.salla_link_store(
  p_merchant_id uuid,
  p_salla_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_store_name text default null
) returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.salla_link_store_at(p_merchant_id, p_salla_merchant_id, p_access_token, p_refresh_token, p_expires_at, p_store_name, now());
$$;

-- ── salla_apply_authorization: app.store.authorize in event order ────────────
-- Outcomes as salla_record_authorization (linked_updated | pending_saved | stale).
create or replace function public.salla_apply_authorization(
  p_salla_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_event_at timestamptz default null,
  p_scope text default null,
  p_owner_email text default null,
  p_owner_role text default null,
  p_store_name text default null,
  p_store_domain text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_store text := nullif(btrim(p_salla_merchant_id), '');
  v_email text := nullif(lower(btrim(p_owner_email)), '');
  v_role text := case when p_owner_role in ('user', 'team') then p_owner_role end;
  v_merchant_id uuid;
  v_stored_expiry timestamptz;
  v_linked boolean;
  v_uninstalled timestamptz;
  v_rows integer;
begin
  if v_store is null or nullif(p_access_token, '') is null then
    raise exception 'salla_record_authorization: store and access token are required' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('arabclue:salla_store:' || v_store, 0));

  select c.uninstalled_event_at into v_uninstalled from public.salla_store_lifecycle c where c.salla_merchant_id = v_store;

  select id, case when access_token is not null then token_expires_at end
    into v_merchant_id, v_stored_expiry
    from public.merchants
   where salla_merchant_id = v_store
   for update;
  v_linked := found;

  -- Issued before an uninstall that was already applied: Salla revoked these tokens.
  if p_event_at is not null and v_uninstalled is not null and p_event_at < v_uninstalled then
    return jsonb_build_object('outcome', 'stale', 'merchant_id', v_merchant_id);
  end if;

  if v_linked then
    if v_stored_expiry is not null and p_expires_at is not null and v_stored_expiry > p_expires_at then
      return jsonb_build_object('outcome', 'stale', 'merchant_id', v_merchant_id);
    end if;
    update public.merchants
       set access_token = p_access_token,
           refresh_token = p_refresh_token,
           token_expires_at = p_expires_at,
           salla_store_name = coalesce(nullif(btrim(p_store_name), ''), salla_store_name),
           salla_refresh_lease = null,
           salla_refresh_lease_until = null,
           salla_token_invalid_at = null,
           uninstalled_at = null
     where id = v_merchant_id;
    delete from public.salla_installs where salla_merchant_id = v_store;
    perform public.salla_lifecycle_note(v_store, coalesce(p_event_at, now()), null);
    return jsonb_build_object('outcome', 'linked_updated', 'merchant_id', v_merchant_id);
  end if;

  insert into public.salla_installs as i (
    salla_merchant_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, scope,
    owner_email, owner_role, store_name, store_domain, authorized_at, updated_at
  ) values (
    v_store, p_access_token, p_refresh_token, p_expires_at, p_scope,
    v_email, v_role, nullif(btrim(p_store_name), ''), nullif(btrim(p_store_domain), ''), now(), now()
  )
  on conflict (salla_merchant_id) do update
     set access_token_encrypted = excluded.access_token_encrypted,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         scope = excluded.scope,
         -- identity belongs to the authorization: keep it only when this is the same one redelivered
         owner_email = coalesce(excluded.owner_email,
                                case when i.token_expires_at is not distinct from excluded.token_expires_at then i.owner_email end),
         owner_role = coalesce(excluded.owner_role,
                               case when i.token_expires_at is not distinct from excluded.token_expires_at then i.owner_role end),
         store_name = coalesce(excluded.store_name, i.store_name),
         store_domain = coalesce(excluded.store_domain, i.store_domain),
         authorized_at = case when i.token_expires_at is not distinct from excluded.token_expires_at
                              then i.authorized_at else now() end,
         token_expires_at = excluded.token_expires_at,
         updated_at = now()
   where i.token_expires_at is null
      or excluded.token_expires_at is null
      or i.token_expires_at <= excluded.token_expires_at;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform public.salla_lifecycle_note(v_store, coalesce(p_event_at, now()), null);
  end if;

  -- retention: an unclaimed authorization is useless once its refresh token is (1 month), drop
  -- it (and the installer's email) after 60 days
  delete from public.salla_installs where authorized_at < now() - interval '60 days';

  return jsonb_build_object('outcome', case when v_rows > 0 then 'pending_saved' else 'stale' end);
end;
$$;

-- ── salla_record_authorization: unchanged contract, event time unknown ───────
create or replace function public.salla_record_authorization(
  p_salla_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scope text default null,
  p_owner_email text default null,
  p_owner_role text default null,
  p_store_name text default null,
  p_store_domain text default null
) returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.salla_apply_authorization(
    p_salla_merchant_id, p_access_token, p_refresh_token, p_expires_at, null,
    p_scope, p_owner_email, p_owner_role, p_store_name, p_store_domain
  );
$$;

-- ── salla_claim_install: link a parked authorization (its own time stays recorded) ──
create or replace function public.salla_claim_install(
  p_merchant_id uuid,
  p_salla_merchant_id text,
  p_owner_email text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_store text := nullif(btrim(p_salla_merchant_id), '');
  v_email text := nullif(lower(btrim(p_owner_email)), '');
  v_install public.salla_installs%rowtype;
begin
  if p_merchant_id is null or v_store is null or v_email is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('arabclue:salla_store:' || v_store, 0));

  select * into v_install
    from public.salla_installs
   where salla_merchant_id = v_store
     and owner_email = v_email
     and owner_role = 'user'
     and authorized_at > now() - interval '30 days'
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return public.salla_link_store_at(
    p_merchant_id, v_store, v_install.access_token_encrypted, v_install.refresh_token_encrypted,
    v_install.token_expires_at, v_install.store_name, null
  );
end;
$$;

-- ── salla_record_uninstall: app.uninstalled in event order ───────────────────
-- Outcomes (jsonb {"outcome": ...}):
--   uninstalled  tokens of the linked merchant (if any) cleared, parked install dropped
--   stale        an authorization newer than this uninstall is already applied: nothing changed
create or replace function public.salla_record_uninstall(
  p_salla_merchant_id text,
  p_event_at timestamptz default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_store text := nullif(btrim(p_salla_merchant_id), '');
  v_authorized timestamptz;
  v_merchant_id uuid;
begin
  if v_store is null then
    raise exception 'salla_record_uninstall: store is required' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('arabclue:salla_store:' || v_store, 0));

  select c.authorized_event_at into v_authorized from public.salla_store_lifecycle c where c.salla_merchant_id = v_store;
  if p_event_at is not null and v_authorized is not null and p_event_at < v_authorized then
    return jsonb_build_object('outcome', 'stale');
  end if;

  update public.merchants
     set access_token = null,
         refresh_token = null,
         token_expires_at = null,
         salla_refresh_lease = null,
         salla_refresh_lease_until = null,
         salla_token_invalid_at = null,
         uninstalled_at = now()
   where salla_merchant_id = v_store
  returning id into v_merchant_id;

  delete from public.salla_installs where salla_merchant_id = v_store;
  perform public.salla_lifecycle_note(v_store, null, coalesce(p_event_at, now()));

  return jsonb_build_object('outcome', 'uninstalled', 'merchant_id', v_merchant_id);
end;
$$;

-- ── privileges (service role only) ───────────────────────────────────────────
revoke execute on function public.salla_lifecycle_note(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.salla_lifecycle_note(text, timestamptz, timestamptz) to service_role;

revoke execute on function public.salla_link_store_at(uuid, text, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.salla_link_store_at(uuid, text, text, text, timestamptz, text, timestamptz) to service_role;

revoke execute on function public.salla_link_store(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.salla_link_store(uuid, text, text, text, timestamptz, text) to service_role;

revoke execute on function public.salla_apply_authorization(text, text, text, timestamptz, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.salla_apply_authorization(text, text, text, timestamptz, timestamptz, text, text, text, text, text) to service_role;

revoke execute on function public.salla_record_authorization(text, text, text, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.salla_record_authorization(text, text, text, timestamptz, text, text, text, text, text) to service_role;

revoke execute on function public.salla_claim_install(uuid, text, text) from public, anon, authenticated;
grant execute on function public.salla_claim_install(uuid, text, text) to service_role;

revoke execute on function public.salla_record_uninstall(text, timestamptz) from public, anon, authenticated;
grant execute on function public.salla_record_uninstall(text, timestamptz) to service_role;

notify pgrst, 'reload schema';
