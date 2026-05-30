-- Platform-wide settings (admin only — no RLS policies; service role access)

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table platform_settings enable row level security;

insert into platform_settings (key, value) values
  (
    'agents',
    '{
      "social": { "enabled": true, "cronMinutes": 15, "maxPostsPerRun": 50 },
      "voice": { "enabled": true, "defaultDialect": "khaliji" },
      "seo": { "enabled": true, "model": "gpt-4o-mini", "residency": "global" }
    }'::jsonb
  ),
  (
    'features',
    '{
      "billing": true,
      "zatca": true,
      "wathq": true,
      "socialOAuth": true
    }'::jsonb
  )
on conflict (key) do nothing;
