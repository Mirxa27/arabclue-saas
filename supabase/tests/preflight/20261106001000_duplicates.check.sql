-- After the remaining migrations ran on top of the duplicate rows:
--  * nothing aborted (we got here) and later migrations still applied
--  * brand_kits collapsed to the newest kit per merchant, unique index created
--  * ambiguous duplicates (owner, phone number, channel id) were left alone and their
--    unique index skipped, until an operator resolves them and re-runs the migration
do $$
begin
  assert to_regclass('public.agent_settings') is not null, 'later migrations must still apply';
  assert not has_column_privilege('authenticated', 'public.merchants', 'plan', 'UPDATE'), 'grants migration must still apply';

  assert (select count(*) from public.brand_kits where merchant_id = '00000000-0000-4000-8000-00000000f103') = 1,
    'duplicate brand kits must collapse to one';
  assert (select essence from public.brand_kits where merchant_id = '00000000-0000-4000-8000-00000000f103') = 'newest',
    'the most recently updated brand kit must survive';
  assert (select essence from public.brand_kits where merchant_id = '00000000-0000-4000-8000-00000000f101') = 'single',
    'non-duplicate brand kits are untouched';
  assert to_regclass('public.brand_kits_merchant_id_key') is not null, 'brand_kits unique index must exist';

  assert to_regclass('public.merchants_owner_user_id_key') is null, 'owner index must be skipped while duplicates exist';
  assert to_regclass('public.voice_configs_phone_number_key') is null, 'phone index must be skipped while duplicates exist';
  assert to_regclass('public.social_channels_platform_external_id_key') is null, 'channel index must be skipped while duplicates exist';
  assert (select count(*) from public.merchants where owner_user_id = '00000000-0000-4000-8000-00000000f001') = 2,
    'ambiguous merchant duplicates must not be deleted';
  assert (select count(*) from public.voice_configs where phone_number = '+966500000777') = 2,
    'ambiguous phone duplicates must not be modified';
end $$;

-- An operator resolves the conflicts and re-runs the migration: the indexes appear.
update public.merchants set owner_user_id = null where id = '00000000-0000-4000-8000-00000000f102';
update public.voice_configs set phone_number = null where merchant_id = '00000000-0000-4000-8000-00000000f101';
delete from public.social_channels where merchant_id = '00000000-0000-4000-8000-00000000f101';

\ir ../../migrations/20261106001000_rls_policies_and_uniques.sql

do $$
begin
  assert to_regclass('public.merchants_owner_user_id_key') is not null, 'owner index must be created on re-run';
  assert to_regclass('public.voice_configs_phone_number_key') is not null, 'phone index must be created on re-run';
  assert to_regclass('public.social_channels_platform_external_id_key') is not null, 'channel index must be created on re-run';
end $$;
