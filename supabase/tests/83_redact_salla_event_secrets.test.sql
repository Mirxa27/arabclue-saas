-- RB-S4 (20261106007300_redact_salla_event_secrets.sql): salla_strip_secrets() mirrors
-- stripSallaSecrets (lib/salla/app-events.ts). The migration's rewrite of rows already stored is
-- proven by supabase/tests/preflight/20261106007100_salla_history.{seed,check}.sql.
do $$
declare
  deep jsonb := '"leaf"'::jsonb;
  i integer;
begin
  -- the documented app.store.authorize payload loses its tokens, keeps everything else
  assert public.salla_strip_secrets(
    '{"event":"app.store.authorize","merchant":1234509876,"created_at":"2022-12-31 12:31:25",
      "data":{"access_token":"AT","expires":1634819484,"refresh_token":"RT","scope":"offline_access","token_type":"bearer"}}'::jsonb
  ) = '{"event":"app.store.authorize","merchant":1234509876,"created_at":"2022-12-31 12:31:25",
        "data":{"expires":1634819484,"scope":"offline_access","token_type":"bearer"}}'::jsonb,
    'authorize payload: tokens removed';

  -- any depth, inside arrays, any letter case — the same key set as the TypeScript stripper
  assert public.salla_strip_secrets(
    '{"data":{"id":9,"settings":{"Access_Token":"x","nested":[{"refresh_token":"y","keep":"me"},{"PASSWORD":"p"}]},
      "id_token":"i","token":"t","client_secret":"c","secret":"s","Authorization":"Bearer z"}}'::jsonb
  ) = '{"data":{"id":9,"settings":{"nested":[{"keep":"me"},{}]}}}'::jsonb,
    'credential keys removed at any depth';

  -- only exact key names: look-alikes and values are kept
  assert public.salla_strip_secrets('{"tokens":1,"token_type":"bearer","access_token_count":2,"note":"access_token"}'::jsonb)
       = '{"tokens":1,"token_type":"bearer","access_token_count":2,"note":"access_token"}'::jsonb,
    'look-alike keys and string values are kept';

  -- scalars, arrays and null pass through
  assert public.salla_strip_secrets('"text"'::jsonb) = '"text"'::jsonb, 'scalar kept';
  assert public.salla_strip_secrets('[1,{"token":"t","a":2}]'::jsonb) = '[1,{"a":2}]'::jsonb, 'array handled';
  assert public.salla_strip_secrets(null) is null, 'null kept';

  -- deeper than 32 levels becomes null (as in TypeScript)
  for i in 1..40 loop
    deep := jsonb_build_object('k', deep);
  end loop;
  assert public.salla_strip_secrets(deep)::text not like '%leaf%', 'over-deep values are dropped';

  assert not has_function_privilege('anon', 'public.salla_strip_secrets(jsonb,integer)', 'execute'), 'anon must not execute salla_strip_secrets';
  assert not has_function_privilege('authenticated', 'public.salla_strip_secrets(jsonb,integer)', 'execute'), 'authenticated must not execute salla_strip_secrets';
end $$;
