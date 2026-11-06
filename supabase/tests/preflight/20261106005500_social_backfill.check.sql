-- After 20261106005500 ran on top of the seeded production-like rows.
do $$
declare
  r record;
begin
  -- entitled merchants already using social keep publishing: the switch is backfilled on
  select * into r from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000055a2' and persona_role = 'social';
  assert r.enabled and r.status = 'active', 'merchant with a connected channel: social agent on';
  select * into r from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000055b2' and persona_role = 'social';
  assert r.enabled and r.status = 'active', 'merchant with queued posts (grace period): social agent on';

  -- an explicit choice is kept
  select * into r from public.agent_settings where merchant_id = '00000000-0000-4000-8000-0000000055c2' and persona_role = 'social';
  assert not r.enabled and r.status = 'idle', 'an agent the merchant switched off stays off';

  -- unentitled or unused: no row (the dashboard shows "no row" as off)
  assert not exists (select 1 from public.agent_settings where merchant_id in (
      '00000000-0000-4000-8000-0000000055d2', '00000000-0000-4000-8000-0000000055e2', '00000000-0000-4000-8000-0000000055f2')),
    'lite, unpaid and non-social merchants get no agent row';

  -- old rows: still valid under the new constraints, outcomes start empty, state unchanged
  select * into r from public.social_posts where id = '00000000-0000-4000-8000-0000000055b3';
  assert r.status = 'scheduled' and r.publish_results = '{}'::jsonb and r.media = '[]'::jsonb
     and r.product_ids = '{}'::text[] and r.claim_id is null and r.attempts = 0,
    format('queued post after migration: %s %s %s', r.status, r.publish_results, r.media);
  select * into r from public.social_posts where id = '00000000-0000-4000-8000-0000000055a3';
  assert r.status = 'published' and r.remote_ids = '{"x": "tw-1"}'::jsonb, 'a published post keeps its remote ids';

  -- nothing else was switched on
  assert (select count(*) from public.agent_settings where persona_role = 'social') = 3, 'exactly three social agent rows';
end $$;
