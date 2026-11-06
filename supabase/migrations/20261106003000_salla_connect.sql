-- arabclue · Salla connect: store linking, Easy Mode installs, single-use refresh tokens (F12 / F28)
--
-- 1. merchants gets the columns the token layer needs:
--      salla_store_name           display name of the linked store (seller_name, the legal name
--                                 printed on ZATCA invoices, is only filled when still empty)
--      salla_refresh_lease(_until) per-merchant mutex around Salla's token refresh. Salla refresh
--                                 tokens are single-use: using one twice revokes every token of
--                                 the install and the merchant must reinstall the app
--                                 (docs.salla.dev/doc-421118, "Refresh Token Reuse").
--      salla_token_invalid_at     Salla rejected the refresh token (invalid_grant): reconnect needed
--    access_token / refresh_token hold enc:v1: ciphertext (lib/crypto/secrets.ts) from now on.
--
-- 2. salla_installs: Easy Mode authorizations (`app.store.authorize` webhook) for stores that are
--    not linked to an arabclue merchant yet. Tokens are stored encrypted, together with the
--    authorizing Salla user's email/role from accounts.salla.sa/oauth2/user/info. A row is only
--    ever linked to a merchant by salla_claim_install(), which the API calls for a signed-in user
--    whose confirmed email matches and whose Salla role is the store owner ('user').
--    Service role only: RLS on, no policies, no grants for anon/authenticated.
--
-- 3. Functions (service_role only; all take the same per-store advisory lock, so linking, Easy Mode
--    re-authorization and claims of one store are serialised):
--      salla_link_store            link a store + tokens to a merchant (OAuth callback, claims)
--      salla_record_authorization  app.store.authorize → update the linked merchant or park a pending row
--      salla_claim_install         email-verified claim of a pending row
--      salla_claim_refresh_lease   take the refresh mutex for a merchant
--
-- Re-runnable.

-- ── merchants: token-layer columns ───────────────────────────────────────────
alter table public.merchants
  add column if not exists salla_store_name text,
  add column if not exists salla_refresh_lease uuid,
  add column if not exists salla_refresh_lease_until timestamptz,
  add column if not exists salla_token_invalid_at timestamptz;

-- ── pending Easy Mode installs ───────────────────────────────────────────────
create table if not exists public.salla_installs (
  salla_merchant_id text primary key,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scope text,
  -- the Salla user who authorized the install (user/info); not always the owner
  owner_email text,
  owner_role text,
  store_name text,
  store_domain text,
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salla_installs_store_id_not_blank check (btrim(salla_merchant_id) <> ''),
  constraint salla_installs_owner_email_normalized check (owner_email is null or owner_email = lower(btrim(owner_email))),
  constraint salla_installs_owner_role check (owner_role is null or owner_role in ('user', 'team'))
);

create index if not exists salla_installs_owner_email_idx
  on public.salla_installs (owner_email, authorized_at desc) where owner_email is not null;
create index if not exists salla_installs_authorized_at_idx on public.salla_installs (authorized_at);

alter table public.salla_installs enable row level security;

revoke all on table public.salla_installs from anon, authenticated;
grant select, insert, update, delete on table public.salla_installs to service_role;

-- ── salla_link_store ─────────────────────────────────────────────────────────
-- Outcomes (jsonb {"outcome": ...}):
--   linked               the merchant now owns the store and holds the given tokens
--   store_already_linked another merchant owns this Salla store (merchants.salla_merchant_id is unique)
--   merchant_not_found   no merchant with p_merchant_id
create or replace function public.salla_link_store(
  p_merchant_id uuid,
  p_salla_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_store_name text default null
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

  return jsonb_build_object('outcome', 'linked', 'merchant_id', p_merchant_id, 'salla_merchant_id', v_store);
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'store_already_linked');
end;
$$;

-- ── salla_record_authorization ───────────────────────────────────────────────
-- An Easy Mode authorization (app.store.authorize, HMAC-verified by the route). Newer tokens win:
-- a token set expiring earlier than the one stored is a late redelivery of an older
-- authorization and is ignored (same expiry = the same authorization redelivered → re-applied).
-- Outcomes:
--   linked_updated  the store belongs to a merchant: its tokens were replaced (reconnects after
--                   an uninstall/reinstall too)
--   pending_saved   no merchant owns the store: tokens parked in salla_installs until a claim
--   stale           an equal-or-newer authorization is already stored
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
  v_rows integer;
begin
  if v_store is null or nullif(p_access_token, '') is null then
    raise exception 'salla_record_authorization: store and access token are required' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('arabclue:salla_store:' || v_store, 0));

  select id, case when access_token is not null then token_expires_at end
    into v_merchant_id, v_stored_expiry
    from public.merchants
   where salla_merchant_id = v_store
   for update;

  if found then
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

  -- retention: an unclaimed authorization is useless once its refresh token is (1 month), drop
  -- it (and the installer's email) after 60 days
  delete from public.salla_installs where authorized_at < now() - interval '60 days';

  return jsonb_build_object('outcome', case when v_rows > 0 then 'pending_saved' else 'stale' end);
end;
$$;

-- ── salla_claim_install ──────────────────────────────────────────────────────
-- Links a parked Easy Mode authorization to p_merchant_id when p_owner_email (the signed-in
-- user's confirmed email, supplied by the server) is the email of the Salla store owner who
-- authorized it. Store team members ('team') and authorizations older than 30 days (the refresh
-- token's lifetime) cannot be claimed this way — they connect through the OAuth start flow.
-- Outcomes: not_found, or those of salla_link_store.
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

  return public.salla_link_store(
    p_merchant_id, v_store, v_install.access_token_encrypted, v_install.refresh_token_encrypted,
    v_install.token_expires_at, v_install.store_name
  );
end;
$$;

-- ── salla_claim_refresh_lease ────────────────────────────────────────────────
-- Returns a lease id when the caller may refresh this merchant's Salla tokens now, null when
-- another worker holds a live lease (or there is nothing to refresh). The holder persists the
-- new tokens with `… where salla_refresh_lease = <lease> and refresh_token = <old>` and clears
-- the lease; a crashed holder's lease expires after p_lease_seconds (5–300).
create or replace function public.salla_claim_refresh_lease(
  p_merchant_id uuid,
  p_lease_seconds integer default 60
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lease uuid := gen_random_uuid();
begin
  update public.merchants
     set salla_refresh_lease = v_lease,
         salla_refresh_lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 5), 300))
   where id = p_merchant_id
     and refresh_token is not null
     and salla_token_invalid_at is null
     and (salla_refresh_lease_until is null or salla_refresh_lease_until < now());
  if found then
    return v_lease;
  end if;
  return null;
end;
$$;

-- ── privileges ───────────────────────────────────────────────────────────────
revoke execute on function public.salla_link_store(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.salla_link_store(uuid, text, text, text, timestamptz, text) to service_role;

revoke execute on function public.salla_record_authorization(text, text, text, timestamptz, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.salla_record_authorization(text, text, text, timestamptz, text, text, text, text, text) to service_role;

revoke execute on function public.salla_claim_install(uuid, text, text) from public, anon, authenticated;
grant execute on function public.salla_claim_install(uuid, text, text) to service_role;

revoke execute on function public.salla_claim_refresh_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.salla_claim_refresh_lease(uuid, integer) to service_role;

notify pgrst, 'reload schema';
