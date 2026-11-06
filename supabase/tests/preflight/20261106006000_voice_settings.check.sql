-- After 20261106006000_voice_agent.sql (and later migrations) ran on top of the seed:
--  * oversized settings were trimmed and every bound is VALIDATED (no NOT VALID escape hatch);
--  * hand-over numbers were normalised to E.164, an undialable one cleared;
--  * rows keep the dialect they had ('khaliji' from the old default); new rows get NULL;
--  * nobody's on/off switch changed.
do $$
begin
  assert (select char_length(knowledge) from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f602') = 4000,
    'oversized knowledge must be trimmed to 4000 chars';
  assert (select char_length(hours) from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f602') = 200,
    'oversized hours must be trimmed to 200 chars';

  assert (select escalation_phone from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f606') = '+966551110003',
    'a local 05… number with separators must become E.164';
  -- Arabic-Indic digits are translated character-wise, which needs a UTF8 database (Supabase is
  -- UTF8; the throwaway local cluster of scripts/db-test.sh is SQL_ASCII, CI's postgres:16 UTF8).
  if (select pg_encoding_to_char(encoding) from pg_database where datname = current_database()) = 'UTF8' then
    assert (select escalation_phone from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f602') = '+966551110000',
      'an Arabic-Indic local number must become E.164';
  else
    assert (select escalation_phone ~ '^\+[1-9][0-9]{7,14}$' or escalation_phone is null
              from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f602'),
      'whatever the encoding, the stored hand-over number is E.164 or cleared';
  end if;
  assert (select escalation_phone from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f603') is null,
    'an undialable hand-over number must be cleared';
  assert (select escalation_phone from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f604') = '+966551110001',
    'a 00-prefixed number must become E.164';
  assert (select escalation_phone from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f605') = '+966551110002',
    'an E.164 number is kept';
  assert (select knowledge from public.voice_configs where merchant_id = '00000000-0000-4000-8000-00000000f603') = 'short',
    'in-bounds settings are untouched';

  assert (select count(*) from public.voice_configs where merchant_id in (
            '00000000-0000-4000-8000-00000000f602', '00000000-0000-4000-8000-00000000f603',
            '00000000-0000-4000-8000-00000000f604', '00000000-0000-4000-8000-00000000f605',
            '00000000-0000-4000-8000-00000000f606')
          and dialect = 'khaliji') = 5, 'existing rows keep their dialect';
  assert (select count(*) from public.voice_configs where enabled) = 2, 'no on/off switch may change';

  assert (select bool_and(convalidated) from pg_constraint
           where conrelid = 'public.voice_configs'::regclass
             and conname in ('voice_configs_knowledge_len', 'voice_configs_hours_len',
                             'voice_configs_escalation_phone_e164', 'voice_configs_dialect_check')),
    'every voice_configs bound must be validated';
  assert (select count(*) from pg_constraint
           where conrelid = 'public.voice_configs'::regclass
             and conname in ('voice_configs_knowledge_len', 'voice_configs_hours_len',
                             'voice_configs_escalation_phone_e164', 'voice_configs_dialect_check')) = 4,
    'all four bounds must exist';
end $$;
