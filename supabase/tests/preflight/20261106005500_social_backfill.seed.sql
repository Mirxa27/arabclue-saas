-- Rows a production database holds before 20261106005500 (social publishing):
--  * merchants already using social (connected channels, queued posts) with no agent_settings
--    row — the pre-agent_settings toggles never persisted (UI-007/F13);
--  * one merchant who explicitly switched the agent off after agent_settings shipped;
--  * unentitled merchants with channels (must not be switched on);
--  * old-shape social_posts rows (scheduled / published / null remote_ids).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000055a1', 'channel@social.example'),
  ('00000000-0000-4000-8000-0000000055b1', 'queued@social.example'),
  ('00000000-0000-4000-8000-0000000055c1', 'off@social.example'),
  ('00000000-0000-4000-8000-0000000055d1', 'lite@social.example'),
  ('00000000-0000-4000-8000-0000000055e1', 'pending@social.example'),
  ('00000000-0000-4000-8000-0000000055f1', 'idle@social.example');

insert into public.merchants (id, owner_user_id, seller_name, plan, subscription_status) values
  ('00000000-0000-4000-8000-0000000055a2', '00000000-0000-4000-8000-0000000055a1', 'Channel', 'plus', 'active'),
  ('00000000-0000-4000-8000-0000000055b2', '00000000-0000-4000-8000-0000000055b1', 'Queued', 'pro', 'past_due'),
  ('00000000-0000-4000-8000-0000000055c2', '00000000-0000-4000-8000-0000000055c1', 'Switched off', 'plus', 'active'),
  ('00000000-0000-4000-8000-0000000055d2', '00000000-0000-4000-8000-0000000055d1', 'Lite', 'lite', 'active'),
  ('00000000-0000-4000-8000-0000000055e2', '00000000-0000-4000-8000-0000000055e1', 'Unpaid', 'plus', 'pending'),
  ('00000000-0000-4000-8000-0000000055f2', '00000000-0000-4000-8000-0000000055f1', 'No social', 'enterprise', 'active');

insert into public.social_channels (merchant_id, platform, external_id, access_token_encrypted) values
  ('00000000-0000-4000-8000-0000000055a2', 'x', 'x-55a', 'enc:v1:a'),
  ('00000000-0000-4000-8000-0000000055c2', 'instagram', 'ig-55c', 'enc:v1:c'),
  ('00000000-0000-4000-8000-0000000055d2', 'instagram', 'ig-55d', 'enc:v1:d'),
  ('00000000-0000-4000-8000-0000000055e2', 'x', 'x-55e', 'enc:v1:e');

insert into public.agent_settings (merchant_id, persona_role, enabled, status) values
  ('00000000-0000-4000-8000-0000000055c2', 'social', false, 'idle');

insert into public.social_posts (id, merchant_id, scheduled_for, platforms, copies, status, remote_ids, published_at) values
  ('00000000-0000-4000-8000-0000000055b3', '00000000-0000-4000-8000-0000000055b2', '2026-11-20T09:00:00Z', '{x}',
   '{"x": {"caption": "queued"}}', 'scheduled', null, null),
  ('00000000-0000-4000-8000-0000000055a3', '00000000-0000-4000-8000-0000000055a2', '2026-10-20T09:00:00Z', '{x}',
   '{"x": {"caption": "old"}}', 'published', '{"x": "tw-1"}', '2026-10-20T09:00:10Z');
