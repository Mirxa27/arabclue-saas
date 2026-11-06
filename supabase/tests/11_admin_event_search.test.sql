-- admin_search_events: literal search over kind + payload text, filters, paging, privileges
do $$
declare
  n bigint;
  total bigint;
begin
  insert into public.events (kind, merchant, payload, created_at) values
    ('social.inbound', 'm-1', '{"text":"hello 100% real_deal"}', now() - interval '3 minutes'),
    ('voice.inbound_call', 'm-1', '{"from":"+966500000000"}', now() - interval '2 minutes'),
    ('social.escalation', 'm-2', '{"text":"refund please"}', now() - interval '1 minute');

  select count(*) into n from public.admin_search_events('refund');
  assert n = 1, format('payload search: expected 1, got %s', n);

  select count(*) into n from public.admin_search_events('social.');
  assert n = 2, format('kind search: expected 2, got %s', n);

  -- LIKE wildcards are literal: '%' and '_' do not match everything
  select count(*) into n from public.admin_search_events('100%');
  assert n = 1, format('literal %% search: expected 1, got %s', n);
  select count(*) into n from public.admin_search_events('real_deal');
  assert n = 1, format('literal _ search: expected 1, got %s', n);
  select count(*) into n from public.admin_search_events('%');
  assert n = 1, format('bare %% must be literal: expected 1, got %s', n);

  select count(*) into n from public.admin_search_events(null, null, 'm-1');
  assert n = 2, format('merchant filter: expected 2, got %s', n);
  select count(*) into n from public.admin_search_events(null, 'social.escalation');
  assert n = 1, format('kind filter: expected 1, got %s', n);

  -- paging + total_count over the whole match set
  select count(*), max(total_count) into n, total from public.admin_search_events(null, null, null, 2, 0);
  assert n = 2 and total = 3, format('page 1: expected 2 rows / total 3, got %s / %s', n, total);
  select count(*) into n from public.admin_search_events(null, null, null, 2, 2);
  assert n = 1, format('page 2: expected 1, got %s', n);
  -- limit is clamped to 1..100
  select count(*) into n from public.admin_search_events(null, null, null, 0, 0);
  assert n = 1, format('limit clamp: expected 1, got %s', n);

  assert not has_function_privilege('anon', 'public.admin_search_events(text,text,text,integer,integer)', 'execute'),
    'anon must not search events';
  assert not has_function_privilege('authenticated', 'public.admin_search_events(text,text,text,integer,integer)', 'execute'),
    'authenticated must not search events';

  delete from public.events where merchant in ('m-1', 'm-2');
end $$;
