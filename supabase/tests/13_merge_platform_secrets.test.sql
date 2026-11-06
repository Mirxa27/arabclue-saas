-- merge_platform_secrets: creates the row, merges without losing other keys, removes keys, is service-role only
do $$
declare
  v jsonb;
begin
  delete from public.platform_settings where key = 'secrets';

  perform public.merge_platform_secrets('{"A":"enc-a"}'::jsonb, '{}');
  select value into v from public.platform_settings where key = 'secrets';
  assert v = '{"A":"enc-a"}'::jsonb, format('creates the row: got %s', v);

  -- two independent "card saves" each touching a different key keep both
  perform public.merge_platform_secrets('{"B":"enc-b"}'::jsonb, '{}');
  perform public.merge_platform_secrets('{"C":"enc-c"}'::jsonb, '{}');
  select value into v from public.platform_settings where key = 'secrets';
  assert v = '{"A":"enc-a","B":"enc-b","C":"enc-c"}'::jsonb, format('merge keeps other keys: got %s', v);

  -- overwrite one key and remove another in a single call (precedence of || vs -)
  perform public.merge_platform_secrets('{"A":"enc-a2"}'::jsonb, array['B']);
  select value into v from public.platform_settings where key = 'secrets';
  assert v = '{"A":"enc-a2","C":"enc-c"}'::jsonb, format('set + remove: got %s', v);

  -- removing a key that is not present is a no-op
  perform public.merge_platform_secrets('{}'::jsonb, array['NOPE']);
  select value into v from public.platform_settings where key = 'secrets';
  assert v = '{"A":"enc-a2","C":"enc-c"}'::jsonb, format('remove missing key: got %s', v);

  assert not has_function_privilege('anon', 'public.merge_platform_secrets(jsonb,text[])', 'execute'), 'anon must not write secrets';
  assert not has_function_privilege('authenticated', 'public.merge_platform_secrets(jsonb,text[])', 'execute'), 'authenticated must not write secrets';
  assert has_function_privilege('service_role', 'public.merge_platform_secrets(jsonb,text[])', 'execute'), 'service_role must write secrets';

  delete from public.platform_settings where key = 'secrets';
end $$;

-- admin_plan_mix: exact grouped counts (no 1000-row cap), service-role only
do $$
declare
  u uuid; i int; n bigint;
begin
  for i in 1..1205 loop
    u := gen_random_uuid();
    insert into auth.users (id, email) values (u, format('mix-%s@example.test', i));
    insert into public.merchants (owner_user_id, seller_name, plan, subscription_status)
      values (u, 'mix', case when i % 2 = 0 then 'pro' else 'lite' end, case when i % 3 = 0 then 'active' else 'pending' end);
  end loop;
  select sum(merchants) into n from public.admin_plan_mix() where true;
  assert n >= 1205, format('plan mix must count every merchant (no row cap), got %s', n);
  select merchants into n from public.admin_plan_mix() where plan = 'pro' and subscription_status = 'active';
  assert n = 200, format('pro/active (i %% 6 = 0 for i in 1..1205): expected 200, got %s', n);
  assert not has_function_privilege('authenticated', 'public.admin_plan_mix()', 'execute'), 'authenticated must not read the plan mix';
  delete from public.merchants where seller_name = 'mix';
  delete from auth.users where email like 'mix-%@example.test';
end $$;
