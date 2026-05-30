-- arabclue · webhook idempotency (dedupe provider deliveries)

create table if not exists webhook_events (
  id bigserial primary key,
  provider text not null,
  event_id text not null,
  payload_hash text,
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists webhook_events_provider_idx on webhook_events(provider, processed_at desc);

alter table voice_configs
  add column if not exists twilio_incoming_sid text;
