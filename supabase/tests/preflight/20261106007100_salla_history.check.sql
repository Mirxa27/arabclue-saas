-- After 20261106007100 (link history), 20261106007200 (lifecycle) and 20261106007300 (redaction)
-- ran on top of the seeded production-like rows.
do $$
declare
  linked constant uuid := '00000000-0000-4000-8000-0000000071a2';
  uninstalled constant uuid := '00000000-0000-4000-8000-0000000071b2';
  nostore constant uuid := '00000000-0000-4000-8000-0000000071c2';
  p jsonb;
begin
  -- RB-S1: the stores merchants hold today are in the history, so Disconnect cannot lose them
  assert (select count(*) from public.salla_store_links where merchant_id = linked and salla_merchant_id = '71001' and unlinked_at is null) = 1,
    'backfill: linked merchant has an open period';
  assert (select linked_at from public.salla_store_links where merchant_id = linked) = '2026-10-01T10:00:00Z',
    'backfill: period starts at installed_at';
  assert (select count(*) from public.salla_store_links where merchant_id = uninstalled and salla_merchant_id = '71002') = 1,
    'backfill: an uninstalled store still linked by id is recorded too';
  assert not exists (select 1 from public.salla_store_links where merchant_id = nostore), 'no store, no period';
  assert exists (select 1 from public.salla_merchant_event_windows(linked) w where w.salla_merchant_id = '71001' and w.from_at is null and w.to_at is null),
    'the linked merchant owns all of its store''s events';

  -- Disconnect after the deploy keeps the key for erasure/export
  update public.merchants set salla_merchant_id = null, access_token = null, refresh_token = null where id = linked;
  assert exists (select 1 from public.salla_merchant_event_windows(linked) w where w.salla_merchant_id = '71001'),
    'after Disconnect the store id is still a PDPL key';

  -- RB-S2: lifecycle watermarks start from today's state
  assert (select authorized_event_at = '2026-10-01T10:00:00Z' and uninstalled_event_at is null
            from public.salla_store_lifecycle where salla_merchant_id = '71001'), 'connected store: authorized at installed_at';
  assert (select authorized_event_at is null and uninstalled_event_at = '2026-10-20T08:00:00Z'
            from public.salla_store_lifecycle where salla_merchant_id = '71002'), 'tokens gone: uninstalled at uninstalled_at';
  assert (select authorized_event_at = '2026-11-01T12:00:00Z' from public.salla_store_lifecycle where salla_merchant_id = '71003'),
    'parked install: authorized at authorized_at';
  -- an authorization delivered late from before that uninstall stays out
  assert (public.salla_apply_authorization('71002', 'enc:v1:late', null, now() + interval '1 day', '2026-10-19T00:00:00Z') ->> 'outcome') = 'stale',
    'a pre-uninstall authorization is stale after the backfill';

  -- RB-S4: plaintext Salla tokens are gone from the old default-branch rows
  select payload into p from public.events where id = 710001;
  assert not (p -> 'data' ? 'access_token') and not (p -> 'data' ? 'refresh_token'), format('authorize tokens redacted: %s', p);
  assert p -> 'data' ->> 'scope' = 'offline_access' and (p -> 'data' ->> 'expires')::bigint = 1793000000 and p ->> 'event' = 'app.store.authorize',
    'the rest of the authorize payload is kept';
  assert (select payload::text from public.events where id = 710001) not like '%PLAINTEXT-%', 'no plaintext token left';

  select payload into p from public.events where id = 710002;
  assert p = '{"event":"app.installed","merchant":71001,"data":{"id":1,"settings":{}}}'::jsonb, format('nested credential redacted: %s', p);

  select payload into p from public.events where id = 710003;
  assert p #>> '{data,customer,email}' = 'buyer@example.test' and p #> '{data,items,0}' = '{"name":"oud"}'::jsonb,
    format('order payload keeps its data, loses credential keys: %s', p);

  -- non-Salla events are not touched, already-clean rows stay as they are
  assert (select payload from public.events where id = 710004) = '{"name":"lookup_order","arguments":{"token":"keep-me"}}'::jsonb,
    'non-Salla events are left alone';
  assert (select payload from public.events where id = 710005) = '{"outcome":"linked_updated","scope":"offline_access"}'::jsonb,
    'clean Salla rows unchanged';
end $$;

-- the redaction is re-runnable (a no-op once clean)
\ir ../../migrations/20261106007300_redact_salla_event_secrets.sql

do $$ begin
  assert (select payload::text from public.events where id = 710001) not like '%PLAINTEXT-%', 'still clean after a re-run';
end $$;
