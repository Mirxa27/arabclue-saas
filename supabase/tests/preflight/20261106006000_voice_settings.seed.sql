-- Production-like voice_configs rows written before 20261106006000_voice_agent.sql, straight
-- through the Data API (no bounds then): oversized knowledge, long hours, hand-over numbers in
-- local / Arabic-Indic / free-text form, and the old 'khaliji' column default.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f612', 'preflight-voice-a@example.test'),
  ('00000000-0000-4000-8000-00000000f613', 'preflight-voice-b@example.test'),
  ('00000000-0000-4000-8000-00000000f614', 'preflight-voice-c@example.test'),
  ('00000000-0000-4000-8000-00000000f615', 'preflight-voice-d@example.test'),
  ('00000000-0000-4000-8000-00000000f616', 'preflight-voice-e@example.test');
insert into public.merchants (id, owner_user_id, seller_name) values
  ('00000000-0000-4000-8000-00000000f602', '00000000-0000-4000-8000-00000000f612', 'Preflight Voice A'),
  ('00000000-0000-4000-8000-00000000f603', '00000000-0000-4000-8000-00000000f613', 'Preflight Voice B'),
  ('00000000-0000-4000-8000-00000000f604', '00000000-0000-4000-8000-00000000f614', 'Preflight Voice C'),
  ('00000000-0000-4000-8000-00000000f605', '00000000-0000-4000-8000-00000000f615', 'Preflight Voice D'),
  ('00000000-0000-4000-8000-00000000f606', '00000000-0000-4000-8000-00000000f616', 'Preflight Voice E');

insert into public.voice_configs (merchant_id, knowledge, hours, escalation_phone, enabled) values
  ('00000000-0000-4000-8000-00000000f602', repeat('معلومة ', 2000), repeat('h', 300), '٠٥٥ ١١١ ٠٠٠٠', true),
  ('00000000-0000-4000-8000-00000000f603', 'short', '9-5', 'call me after 5', false),
  ('00000000-0000-4000-8000-00000000f604', null, null, '00966551110001', true),
  ('00000000-0000-4000-8000-00000000f605', null, null, '+966551110002', false),
  ('00000000-0000-4000-8000-00000000f606', null, null, '055-111 0003', false);
