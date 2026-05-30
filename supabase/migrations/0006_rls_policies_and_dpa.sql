-- arabclue · missing RLS policies + PDPL consent tracking

alter table merchants
  add column if not exists dpa_accepted_at timestamptz,
  add column if not exists dpa_version text default '2025-01';

do $$ begin
  create policy "voice_configs_self" on voice_configs
    for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "bookings_self" on bookings
    for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "seo_content_self" on seo_content
    for all using (merchant_id in (select id from merchants where owner_user_id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "merchants_insert_self" on merchants
    for insert with check (owner_user_id = auth.uid());
exception when duplicate_object then null;
end $$;
