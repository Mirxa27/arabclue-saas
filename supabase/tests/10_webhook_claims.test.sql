-- claim_webhook_event state machine + privileges
do $$
declare
  r text;
  n integer;
begin
  r := public.claim_webhook_event('test', 'e1');
  assert r = 'new', format('first claim: expected new, got %s', r);

  r := public.claim_webhook_event('test', 'e1');
  assert r = 'in_progress', format('concurrent claim: expected in_progress, got %s', r);

  update public.webhook_events set status = 'failed', last_error = 'boom' where provider = 'test' and event_id = 'e1';
  r := public.claim_webhook_event('test', 'e1');
  assert r = 'retry', format('after failure: expected retry, got %s', r);
  select attempts into n from public.webhook_events where provider = 'test' and event_id = 'e1';
  assert n = 2, format('attempts after retry: expected 2, got %s', n);
  assert (select last_error from public.webhook_events where provider = 'test' and event_id = 'e1') is null,
    'retry must clear last_error';

  update public.webhook_events set status = 'done' where provider = 'test' and event_id = 'e1';
  r := public.claim_webhook_event('test', 'e1');
  assert r = 'duplicate', format('after success: expected duplicate, got %s', r);

  -- a crashed worker's claim becomes re-claimable once stale
  insert into public.webhook_events (provider, event_id, status, claimed_at)
  values ('test', 'stale', 'processing', now() - interval '10 minutes');
  r := public.claim_webhook_event('test', 'stale', null, 300);
  assert r = 'retry', format('stale processing: expected retry, got %s', r);

  -- same id under another provider is independent
  r := public.claim_webhook_event('other', 'e1');
  assert r = 'new', format('other provider: expected new, got %s', r);

  -- legacy rows (pre-migration) count as processed
  insert into public.webhook_events (provider, event_id) values ('test', 'legacy');
  r := public.claim_webhook_event('test', 'legacy');
  assert r = 'duplicate', format('legacy row: expected duplicate, got %s', r);

  -- retention keeps recent rows and in-flight claims
  insert into public.webhook_events (provider, event_id, status, processed_at)
  values ('test', 'old-done', 'done', now() - interval '30 days'),
         ('test', 'old-processing', 'processing', now() - interval '30 days');
  n := public.prune_webhook_events(14);
  assert n = 1, format('prune: expected 1 deleted, got %s', n);
  assert exists (select 1 from public.webhook_events where event_id = 'old-processing'), 'prune must keep in-flight claims';

  -- privileges: API roles cannot touch claims or call the functions
  assert not has_table_privilege('anon', 'public.webhook_events', 'select'), 'anon must not read webhook_events';
  assert not has_table_privilege('authenticated', 'public.webhook_events', 'insert'), 'authenticated must not write webhook_events';
  assert has_table_privilege('service_role', 'public.webhook_events', 'update'), 'service_role must write webhook_events';
  assert not has_function_privilege('anon', 'public.claim_webhook_event(text,text,text,integer)', 'execute'), 'anon must not claim';
  assert not has_function_privilege('authenticated', 'public.claim_webhook_event(text,text,text,integer)', 'execute'), 'authenticated must not claim';
  assert has_function_privilege('service_role', 'public.claim_webhook_event(text,text,text,integer)', 'execute'), 'service_role must claim';

  delete from public.webhook_events where provider in ('test', 'other');
end $$;
