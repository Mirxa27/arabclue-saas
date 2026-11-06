-- social_claim_token_refresh + the token-changed trigger (SW-27)
begin;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000006601', 'tok@example.test');
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-000000006611', '00000000-0000-4000-8000-000000006601', 'Tok', 'plus', 'active');
insert into public.social_channels (id, merchant_id, platform, external_id, access_token_encrypted, refresh_token_encrypted, token_expires_at) values
  ('00000000-0000-4000-8000-0000000066c1', '00000000-0000-4000-8000-000000006611', 'x', 'x-1', 'enc:v1:old-access', 'enc:v1:old-refresh', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-0000000066c2', '00000000-0000-4000-8000-000000006611', 'linkedin', 'urn:li:organization:1', 'enc:v1:li', null, now() + interval '30 days');

do $$
declare
  v_lease uuid;
  v_other uuid;
  n integer;
begin
  -- one live lease per channel
  v_lease := public.social_claim_token_refresh('00000000-0000-4000-8000-0000000066c1', 60);
  assert v_lease is not null, 'first worker gets the lease';
  v_other := public.social_claim_token_refresh('00000000-0000-4000-8000-0000000066c1', 60);
  assert v_other is null, 'a second worker must wait while the lease is live';

  -- nothing to refresh without a refresh token
  assert public.social_claim_token_refresh('00000000-0000-4000-8000-0000000066c2', 60) is null,
    'no lease without a refresh token';

  -- the holder stores the rotated pair with a compare-and-swap on (lease, old refresh token)
  update public.social_channels
     set access_token_encrypted = 'enc:v1:new-access', refresh_token_encrypted = 'enc:v1:new-refresh',
         token_expires_at = now() + interval '2 hours', refresh_lease = null, refresh_lease_until = null,
         token_refreshed_at = now()
   where id = '00000000-0000-4000-8000-0000000066c1'
     and refresh_lease = v_lease and refresh_token_encrypted = 'enc:v1:old-refresh';
  get diagnostics n = row_count;
  assert n = 1, 'the lease holder''s compare-and-swap succeeds';

  -- a stale writer holding the spent refresh token cannot overwrite the rotated pair
  update public.social_channels
     set access_token_encrypted = 'enc:v1:stale'
   where id = '00000000-0000-4000-8000-0000000066c1'
     and refresh_lease = v_lease and refresh_token_encrypted = 'enc:v1:old-refresh';
  get diagnostics n = row_count;
  assert n = 0, 'stale compare-and-swap must not apply';

  -- an expired lease can be taken over (crashed holder)
  update public.social_channels set refresh_lease = gen_random_uuid(), refresh_lease_until = now() - interval '1 second'
   where id = '00000000-0000-4000-8000-0000000066c1';
  assert public.social_claim_token_refresh('00000000-0000-4000-8000-0000000066c1', 60) is not null,
    'an expired lease is re-claimable';

  -- invalid_grant: reconnect required, no more leases
  update public.social_channels set token_invalid_at = now(), refresh_lease = null, refresh_lease_until = null
   where id = '00000000-0000-4000-8000-0000000066c1';
  assert public.social_claim_token_refresh('00000000-0000-4000-8000-0000000066c1', 60) is null,
    'no lease once the provider rejected the grant';

  -- reconnecting (new access token) clears the reconnect marker, whoever writes it
  update public.social_channels set access_token_encrypted = 'enc:v1:reconnected', refresh_token_encrypted = 'enc:v1:r2'
   where id = '00000000-0000-4000-8000-0000000066c1';
  assert (select token_invalid_at from public.social_channels where id = '00000000-0000-4000-8000-0000000066c1') is null,
    'a new access token clears token_invalid_at';

  -- …but an unrelated update keeps it
  update public.social_channels set token_invalid_at = now() where id = '00000000-0000-4000-8000-0000000066c1';
  update public.social_channels set external_id = 'x-1b' where id = '00000000-0000-4000-8000-0000000066c1';
  assert (select token_invalid_at from public.social_channels where id = '00000000-0000-4000-8000-0000000066c1') is not null,
    'token_invalid_at survives updates that do not change the access token';

  -- OAuth reconnect path (upsert on merchant_id, platform) also clears it
  insert into public.social_channels (merchant_id, platform, external_id, access_token_encrypted, refresh_token_encrypted)
  values ('00000000-0000-4000-8000-000000006611', 'x', 'x-1b', 'enc:v1:oauth-again', 'enc:v1:r3')
  on conflict (merchant_id, platform) do update
    set access_token_encrypted = excluded.access_token_encrypted, refresh_token_encrypted = excluded.refresh_token_encrypted;
  assert (select token_invalid_at from public.social_channels where id = '00000000-0000-4000-8000-0000000066c1') is null,
    'an OAuth reconnect (upsert) clears token_invalid_at';

  assert not has_function_privilege('authenticated', 'public.social_claim_token_refresh(uuid,integer)', 'execute'), 'authenticated must not lease';
  assert not has_function_privilege('anon', 'public.social_claim_token_refresh(uuid,integer)', 'execute'), 'anon must not lease';
  assert has_function_privilege('service_role', 'public.social_claim_token_refresh(uuid,integer)', 'execute'), 'service_role leases';
  assert not has_function_privilege('authenticated', 'public.social_channels_token_changed()', 'execute'), 'trigger fn is not on the RPC surface';
end $$;

rollback;
