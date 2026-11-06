-- arabclue · support tickets + in-app feedback (F20 / UI-018)
--
-- POST /api/support and POST /api/feedback inserted into tables no migration created,
-- swallowed the error and still answered 201. Both tables are written by the server
-- (service role) after authenticating the user; the author can read their own rows.
-- Rows are tied to the auth user and removed with the account (PDPL erasure).

-- ── support_tickets ──────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete set null,
  category text not null check (category in ('help', 'bug', 'feature', 'billing')),
  message text not null check (char_length(message) between 5 and 5000),
  -- Address the support team should reply to (the account email unless the user gave another).
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  -- Set when the ticket was relayed to SUPPORT_INBOX_EMAIL.
  forwarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_open_idx on public.support_tickets (created_at desc) where status = 'open';

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;

drop policy if exists "support_tickets_select_own" on public.support_tickets;
create policy "support_tickets_select_own" on public.support_tickets
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.support_tickets from anon, authenticated;
grant select on table public.support_tickets to authenticated;
grant select, insert, update, delete on table public.support_tickets to service_role;

-- ── user_feedback ────────────────────────────────────────────────────────────
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete set null,
  sentiment text not null check (sentiment in ('up', 'down')),
  reasons text[] not null default '{}' check (coalesce(array_length(reasons, 1), 0) <= 10),
  note text check (note is null or char_length(note) <= 2000),
  path text check (path is null or char_length(path) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists user_feedback_created_idx on public.user_feedback (created_at desc);

alter table public.user_feedback enable row level security;

drop policy if exists "user_feedback_select_own" on public.user_feedback;
create policy "user_feedback_select_own" on public.user_feedback
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.user_feedback from anon, authenticated;
grant select on table public.user_feedback to authenticated;
grant select, insert, update, delete on table public.user_feedback to service_role;

notify pgrst, 'reload schema';
