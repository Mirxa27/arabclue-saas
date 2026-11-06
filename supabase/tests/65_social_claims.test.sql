-- claim_due_social_posts / social_hold_unpublishable_posts (SW-9, SW-11, SW-13, SW-32)
-- The concurrent case (two cron runs at once → disjoint claims) is proven against the real stack
-- in __tests__/integration/social-publishing.int.test.ts; here: the state machine and gates.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000006501', 'social-a@example.test'),
  ('00000000-0000-4000-8000-000000006502', 'social-b@example.test'),
  ('00000000-0000-4000-8000-000000006503', 'social-c@example.test'),
  ('00000000-0000-4000-8000-000000006504', 'social-d@example.test'),
  ('00000000-0000-4000-8000-000000006505', 'social-e@example.test');

-- A plus/active, agent on · B lite/active · C pro/active, agent switched off
-- D pro/past_due (grace period), agent on · E plus/active, no agent_settings row
insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-000000006511', '00000000-0000-4000-8000-000000006501', 'A', 'plus', 'active'),
  ('00000000-0000-4000-8000-000000006512', '00000000-0000-4000-8000-000000006502', 'B', 'lite', 'active'),
  ('00000000-0000-4000-8000-000000006513', '00000000-0000-4000-8000-000000006503', 'C', 'pro', 'active'),
  ('00000000-0000-4000-8000-000000006514', '00000000-0000-4000-8000-000000006504', 'D', 'pro', 'past_due'),
  ('00000000-0000-4000-8000-000000006515', '00000000-0000-4000-8000-000000006505', 'E', 'plus', 'active');

insert into public.agent_settings (merchant_id, persona_role, enabled, status) values
  ('00000000-0000-4000-8000-000000006511', 'social', true, 'active'),
  ('00000000-0000-4000-8000-000000006512', 'social', true, 'active'),
  ('00000000-0000-4000-8000-000000006513', 'social', false, 'idle'),
  ('00000000-0000-4000-8000-000000006514', 'social', true, 'active');

insert into public.social_posts (id, merchant_id, scheduled_for, platforms, copies, status) values
  -- A: two due, one future, one draft, one far too late
  ('00000000-0000-4000-8000-0000000065a1', '00000000-0000-4000-8000-000000006511', now() - interval '10 minutes', '{x}', '{}', 'scheduled'),
  ('00000000-0000-4000-8000-0000000065a2', '00000000-0000-4000-8000-000000006511', now() - interval '1 minute', '{x}', '{}', 'scheduled'),
  ('00000000-0000-4000-8000-0000000065a3', '00000000-0000-4000-8000-000000006511', now() + interval '1 hour', '{x}', '{}', 'scheduled'),
  ('00000000-0000-4000-8000-0000000065a4', '00000000-0000-4000-8000-000000006511', now() - interval '10 minutes', '{x}', '{}', 'draft'),
  ('00000000-0000-4000-8000-0000000065a5', '00000000-0000-4000-8000-000000006511', now() - interval '7 hours', '{x}', '{}', 'scheduled'),
  -- B (lite) inserted a "scheduled" post straight through the Data API
  ('00000000-0000-4000-8000-0000000065b1', '00000000-0000-4000-8000-000000006512', now() - interval '9 minutes', '{x}', '{}', 'scheduled'),
  -- C paused its agent
  ('00000000-0000-4000-8000-0000000065c1', '00000000-0000-4000-8000-000000006513', now() - interval '8 minutes', '{x}', '{}', 'scheduled'),
  -- D in its grace period
  ('00000000-0000-4000-8000-0000000065d1', '00000000-0000-4000-8000-000000006514', now() - interval '6 minutes', '{x}', '{}', 'scheduled'),
  -- E never switched the agent on
  ('00000000-0000-4000-8000-0000000065e1', '00000000-0000-4000-8000-000000006515', now() - interval '5 minutes', '{x}', '{}', 'scheduled');

do $$
declare
  r record;
  n integer;
  v_claim uuid;
  v_ids uuid[];
  v_plans constant text[] := array['plus', 'pro', 'enterprise'];
  v_statuses constant text[] := array['active', 'past_due'];
begin
  -- SW-32: a row inserted without a status waits for review
  insert into public.social_posts (id, merchant_id, scheduled_for, platforms, copies)
  values ('00000000-0000-4000-8000-0000000065f1', '00000000-0000-4000-8000-000000006511', now() - interval '3 minutes', '{x}', '{}');
  assert (select status from public.social_posts where id = '00000000-0000-4000-8000-0000000065f1') = 'draft',
    'default status must be draft';

  -- ── hold: plan_required + missed_window, nothing else ──────────────────────
  select array_agg(held_post_id order by held_post_id) into v_ids
    from public.social_hold_unpublishable_posts(v_plans, v_statuses, 6 * 3600, 100);
  assert v_ids = array['00000000-0000-4000-8000-0000000065a5', '00000000-0000-4000-8000-0000000065b1']::uuid[],
    format('hold: expected A5 + B1, got %s', v_ids);
  select * into r from public.social_posts where id = '00000000-0000-4000-8000-0000000065b1';
  assert r.status = 'failed' and r.error_code = 'plan_required' and r.error like 'Not published:%',
    format('lite post: %s / %s / %s', r.status, r.error_code, r.error);
  select * into r from public.social_posts where id = '00000000-0000-4000-8000-0000000065a5';
  assert r.status = 'failed' and r.error_code = 'missed_window' and r.error like '%more than 6 hours ago%',
    format('late post: %s / %s / %s', r.status, r.error_code, r.error);
  assert (select status from public.social_posts where id = '00000000-0000-4000-8000-0000000065c1') = 'scheduled',
    'a paused merchant''s post inside the window must be left alone';
  assert (select count(*) from public.social_hold_unpublishable_posts(v_plans, v_statuses, 6 * 3600, 100)) = 0,
    'hold must be idempotent';

  -- ── claim: oldest first, entitled + switched-on merchants only ─────────────
  select array_agg(id order by scheduled_for), min(claim_id::text)::uuid into v_ids, v_claim
    from public.claim_due_social_posts(2, v_plans, v_statuses, 6 * 3600);
  assert v_ids = array['00000000-0000-4000-8000-0000000065a1', '00000000-0000-4000-8000-0000000065d1']::uuid[],
    format('first claim: expected A1, D1 got %s', v_ids);
  select count(distinct claim_id) into n from public.social_posts where id = any (v_ids);
  assert n = 1, 'one claim id per run';
  for r in select * from public.social_posts where id = any (v_ids) loop
    assert r.status = 'publishing' and r.claim_id = v_claim and r.claimed_at is not null and r.attempts = 1,
      format('claimed row %s: %s %s %s', r.id, r.status, r.claimed_at, r.attempts);
  end loop;

  select array_agg(id) into v_ids from public.claim_due_social_posts(10, v_plans, v_statuses, 6 * 3600);
  assert v_ids = array['00000000-0000-4000-8000-0000000065a2']::uuid[],
    format('second claim: expected only A2, got %s', v_ids);
  assert (select claim_id from public.social_posts where id = '00000000-0000-4000-8000-0000000065a2') <> v_claim,
    'a second run gets its own claim id';

  select count(*) into n from public.claim_due_social_posts(10, v_plans, v_statuses, 6 * 3600);
  assert n = 0, format('nothing left to claim, got %s', n);

  -- never claimed: future, draft, paused agent, no agent row
  for r in select id, status from public.social_posts
            where id in ('00000000-0000-4000-8000-0000000065a3', '00000000-0000-4000-8000-0000000065c1',
                         '00000000-0000-4000-8000-0000000065e1') loop
    assert r.status = 'scheduled', format('%s must stay scheduled, is %s', r.id, r.status);
  end loop;
  assert (select status from public.social_posts where id = '00000000-0000-4000-8000-0000000065a4') = 'draft',
    'drafts are never claimed';

  -- resuming the agent makes the paused merchant's post claimable
  update public.agent_settings set enabled = true, status = 'active'
   where merchant_id = '00000000-0000-4000-8000-000000006513' and persona_role = 'social';
  select array_agg(id) into v_ids from public.claim_due_social_posts(10, v_plans, v_statuses, 6 * 3600);
  assert v_ids = array['00000000-0000-4000-8000-0000000065c1']::uuid[], format('after resume: %s', v_ids);

  -- an explicit 'paused' status also stops claiming
  update public.agent_settings set enabled = true, status = 'paused'
   where merchant_id = '00000000-0000-4000-8000-000000006514' and persona_role = 'social';
  update public.social_posts set status = 'scheduled', claim_id = null, claimed_at = null
   where id = '00000000-0000-4000-8000-0000000065d1';
  select count(*) into n from public.claim_due_social_posts(10, v_plans, v_statuses, 6 * 3600);
  assert n = 0, 'a paused agent''s posts are not claimed';

  -- ── constraints ─────────────────────────────────────────────────────────────
  begin
    update public.social_posts set status = 'publishing', claim_id = null where id = '00000000-0000-4000-8000-0000000065a3';
    raise exception 'publishing without a claim must be rejected';
  exception when check_violation then null; end;
  begin
    update public.social_posts set status = 'live' where id = '00000000-0000-4000-8000-0000000065a3';
    raise exception 'unknown status must be rejected';
  exception when check_violation then null; end;
  begin
    update public.social_posts set publish_results = '[]'::jsonb where id = '00000000-0000-4000-8000-0000000065a3';
    raise exception 'publish_results must be an object';
  exception when check_violation then null; end;
  begin
    update public.social_posts set media = '{"url": "x"}'::jsonb where id = '00000000-0000-4000-8000-0000000065a3';
    raise exception 'media must be an array';
  exception when check_violation then null; end;

  -- ── privileges ──────────────────────────────────────────────────────────────
  assert not has_function_privilege('anon', 'public.claim_due_social_posts(integer,text[],text[],integer)', 'execute'), 'anon must not claim';
  assert not has_function_privilege('authenticated', 'public.claim_due_social_posts(integer,text[],text[],integer)', 'execute'), 'authenticated must not claim';
  assert has_function_privilege('service_role', 'public.claim_due_social_posts(integer,text[],text[],integer)', 'execute'), 'service_role claims';
  assert not has_function_privilege('authenticated', 'public.social_hold_unpublishable_posts(text[],text[],integer,integer)', 'execute'), 'authenticated must not hold';
  assert has_function_privilege('service_role', 'public.social_hold_unpublishable_posts(text[],text[],integer,integer)', 'execute'), 'service_role holds';
end $$;

-- An owner cannot run the claim through the Data API.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000006501","role":"authenticated"}', true) as jwt_claims \gset
do $$
begin
  begin
    perform public.claim_due_social_posts(10, array['plus'], array['active'], 21600);
    raise exception 'authenticated must not be able to call claim_due_social_posts';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
