-- arabclue · AI employees marketplace
-- 20+ hireable AI workers with channel integrations and 24/7 autonomous loops.

create extension if not exists "pgcrypto";

-- ── Hired AI employees ──────────────────────────────────────────────────────
create table if not exists ai_employees (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  role_id text not null,                       -- references the catalog (e.g. 'sales-rep')
  display_name text not null,                  -- merchant-customisable name (e.g. "Layla")
  avatar text,                                 -- emoji or url
  language text not null default 'ar' check (language in ('ar','en','ar-en','khaliji','msa')),
  tone text not null default 'professional' check (tone in ('professional','friendly','formal','playful')),
  timezone text not null default 'Asia/Riyadh',
  working_hours jsonb not null default '{"mode":"always","start":"09:00","end":"21:00","days":[0,1,2,3,4,5,6]}'::jsonb,
  knowledge text,                              -- merchant-provided context / playbook
  goals jsonb default '[]'::jsonb,             -- text array of OKRs
  status text not null default 'active' check (status in ('active','paused','offboarded')),
  hire_plan text not null default 'starter' check (hire_plan in ('starter','growth','pro','scale')),
  monthly_charge_halalas integer not null default 9900,
  billing_status text not null default 'trial' check (billing_status in ('trial','active','past_due','canceled')),
  last_billing_payment_id uuid,
  next_billing_at timestamptz,
  trial_ends_at timestamptz,
  hired_at timestamptz default now(),
  paused_at timestamptz,
  offboarded_at timestamptz,
  config jsonb default '{}'::jsonb,            -- role-specific extra fields
  unique (merchant_id, role_id, display_name)
);

create index if not exists ai_employees_merchant_idx on ai_employees(merchant_id);
create index if not exists ai_employees_status_idx on ai_employees(status) where status = 'active';

-- ── Per-employee integrations (channel + role-specific tools) ───────────────
create table if not exists ai_employee_integrations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ai_employees(id) on delete cascade,
  kind text not null,                          -- 'whatsapp', 'telegram', 'slack', 'email', 'gmail', 'salla', 'meta', 'linkedin', 'x', 'tiktok', 'twilio_voice', 'zatca', 'stripe', 'gcal', 'notion', 'hubspot', 'shopify', 'webhook'
  external_id text,                            -- account id / phone number / channel id
  credentials jsonb not null default '{}'::jsonb,  -- access_token, refresh_token, secret, etc.
  config jsonb not null default '{}'::jsonb,   -- webhook url, signing secret, room id, etc.
  status text not null default 'connected' check (status in ('connected','disconnected','error')),
  last_event_at timestamptz,
  created_at timestamptz default now(),
  unique (employee_id, kind)
);

create index if not exists employee_integrations_employee_idx on ai_employee_integrations(employee_id);
create index if not exists employee_integrations_kind_idx on ai_employee_integrations(kind);

-- ── Conversations the employee is having (per-channel thread) ───────────────
create table if not exists ai_employee_conversations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ai_employees(id) on delete cascade,
  channel text not null,                       -- 'whatsapp' | 'telegram' | 'dashboard' | 'email' | 'slack' | ...
  external_id text,                            -- chat id / phone / thread id
  contact_name text,
  contact_handle text,
  subject text,
  status text not null default 'open' check (status in ('open','snoozed','escalated','closed')),
  unread_count integer not null default 0,
  last_message_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (employee_id, channel, external_id)
);

create index if not exists employee_conv_employee_idx on ai_employee_conversations(employee_id, last_message_at desc);
create index if not exists employee_conv_external_idx on ai_employee_conversations(channel, external_id);

create table if not exists ai_employee_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_employee_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  tool_name text,
  tool_payload jsonb,
  tokens integer,
  latency_ms integer,
  created_at timestamptz default now()
);

create index if not exists employee_messages_conv_idx on ai_employee_messages(conversation_id, created_at);

-- ── Tasks the employee owns (internal queue, like Jira) ─────────────────────
create table if not exists ai_employee_tasks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references ai_employees(id) on delete cascade,
  title text not null,
  description text,
  source text not null default 'system' check (source in ('system','user','schedule','webhook','autonomous')),
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done','canceled')),
  result jsonb,
  created_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists employee_tasks_employee_idx on ai_employee_tasks(employee_id, status, due_at);

-- ── Audit log of every autonomous action taken ──────────────────────────────
create table if not exists ai_employee_actions (
  id bigserial primary key,
  employee_id uuid not null references ai_employees(id) on delete cascade,
  action text not null,                        -- 'send_message','create_invoice','book_meeting','schedule_post','rotate_password', ...
  channel text,                                -- whatsapp / telegram / internal
  target text,                                 -- phone / chat / url
  payload jsonb,
  result jsonb,
  status text not null default 'success' check (status in ('success','failure','retry')),
  created_at timestamptz default now()
);

create index if not exists employee_actions_employee_idx on ai_employee_actions(employee_id, created_at desc);

-- ── Activity heartbeat (used by the 24/7 cron) ──────────────────────────────
create table if not exists ai_employee_heartbeats (
  employee_id uuid primary key references ai_employees(id) on delete cascade,
  last_tick_at timestamptz default now(),
  last_active_at timestamptz default now(),
  tasks_completed_24h integer default 0,
  messages_handled_24h integer default 0,
  uptime_pct numeric(5,2) default 100.00
);

-- ── RLS: only the owning merchant can access ────────────────────────────────
alter table ai_employees enable row level security;
alter table ai_employee_integrations enable row level security;
alter table ai_employee_conversations enable row level security;
alter table ai_employee_messages enable row level security;
alter table ai_employee_tasks enable row level security;
alter table ai_employee_actions enable row level security;
alter table ai_employee_heartbeats enable row level security;

drop policy if exists "employees: merchant owner" on ai_employees;
create policy "employees: merchant owner" on ai_employees
  for all using (
    merchant_id in (select id from merchants where owner_user_id = auth.uid())
  ) with check (
    merchant_id in (select id from merchants where owner_user_id = auth.uid())
  );

drop policy if exists "integrations: via employee" on ai_employee_integrations;
create policy "integrations: via employee" on ai_employee_integrations
  for all using (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  ) with check (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );

drop policy if exists "conversations: via employee" on ai_employee_conversations;
create policy "conversations: via employee" on ai_employee_conversations
  for all using (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  ) with check (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );

drop policy if exists "messages: via conv" on ai_employee_messages;
create policy "messages: via conv" on ai_employee_messages
  for all using (
    conversation_id in (
      select c.id from ai_employee_conversations c
      join ai_employees e on e.id = c.employee_id
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  ) with check (
    conversation_id in (
      select c.id from ai_employee_conversations c
      join ai_employees e on e.id = c.employee_id
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );

drop policy if exists "tasks: via employee" on ai_employee_tasks;
create policy "tasks: via employee" on ai_employee_tasks
  for all using (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  ) with check (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );

drop policy if exists "actions: via employee" on ai_employee_actions;
create policy "actions: via employee" on ai_employee_actions
  for select using (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );

drop policy if exists "heartbeats: via employee" on ai_employee_heartbeats;
create policy "heartbeats: via employee" on ai_employee_heartbeats
  for select using (
    employee_id in (
      select e.id from ai_employees e
      join merchants m on m.id = e.merchant_id
      where m.owner_user_id = auth.uid()
    )
  );
