-- next_employees_to_tick: least-recently-ticked first, never-ticked first, only active; mark_employees_ticked rotates
do $$
declare
  m uuid := gen_random_uuid();
  u uuid := gen_random_uuid();
  e_old uuid; e_new uuid; e_never uuid; e_paused uuid;
  ids uuid[];
begin
  insert into auth.users (id, email) values (u, 'tickq@example.test');
  insert into public.merchants (id, owner_user_id, seller_name) values (m, u, 'Tick Queue Test');

  insert into public.ai_employees (merchant_id, role_id, display_name, status, hired_at)
    values (m, 'sales-rep', 'Old', 'active', now() - interval '30 days') returning id into e_old;
  insert into public.ai_employees (merchant_id, role_id, display_name, status, hired_at)
    values (m, 'sales-rep', 'New', 'active', now() - interval '1 day') returning id into e_new;
  insert into public.ai_employees (merchant_id, role_id, display_name, status, hired_at)
    values (m, 'sales-rep', 'Never', 'active', now()) returning id into e_never;
  insert into public.ai_employees (merchant_id, role_id, display_name, status, hired_at)
    values (m, 'sales-rep', 'Paused', 'paused', now() - interval '60 days') returning id into e_paused;

  insert into public.ai_employee_heartbeats (employee_id, last_tick_at) values
    (e_old, now() - interval '1 minute'),
    (e_new, now() - interval '1 hour');

  select array_agg(id) into ids from public.next_employees_to_tick(10);
  assert ids[1] = e_never, 'never-ticked employee must come first';
  assert ids[2] = e_new, 'least recently ticked must come next';
  assert ids[3] = e_old, 'most recently ticked must come last';
  assert not (e_paused = any(ids)), 'paused employees must not be ticked';

  select array_agg(id) into ids from public.next_employees_to_tick(1);
  assert array_length(ids, 1) = 1, 'limit must be honoured';

  perform public.mark_employees_ticked(array[e_never, e_new]);
  select array_agg(id) into ids from public.next_employees_to_tick(10);
  assert ids[1] = e_old, format('after marking, the old one must lead the queue, got %s', ids[1]);

  assert not has_function_privilege('authenticated', 'public.next_employees_to_tick(integer)', 'execute'), 'authenticated must not read the queue';
  assert not has_function_privilege('anon', 'public.mark_employees_ticked(uuid[])', 'execute'), 'anon must not mark ticks';

  delete from public.merchants where id = m;
  delete from auth.users where id = u;
end $$;
