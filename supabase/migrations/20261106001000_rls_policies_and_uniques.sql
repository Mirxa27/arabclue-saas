-- arabclue · RLS lock-down (part 1 of 2): row policies, RLS on unprotected tables,
-- routing-key uniqueness. Column/table privileges are in 20261106001100_api_grants.sql.
--
-- Why: the owner policies were FOR ALL with only a USING clause, which PostgreSQL also
-- uses as the INSERT/UPDATE check. With the public anon key plus their own JWT a merchant
-- could PATCH every column of their own rows through the Data API: merchants.plan /
-- subscription_status (paid-feature bypass), billing_payments.amount_halalas (pay less
-- than the plan price), ai_employees billing columns, ZATCA invoice rows, and routing
-- keys (merchants.salla_merchant_id, voice_configs.phone_number, social_channels.external_id)
-- that steer another merchant's webhooks / calls to themselves.
--
-- Model (enforced together with the grants migration):
--   * merchants, voice_configs, ai_employees: owner may SELECT and UPDATE (voice_configs
--     also INSERT) — the writable columns are limited by column grants.
--   * invoices, billing_payments, social_channels: owner may SELECT only; writes are
--     service-role only (server routes after their own ownership/entitlement checks).
--   * events, wathq_cache, platform_settings, webhook_events: no Data API access at all.
--   * merchant-authored content (brand kits, social plans/posts, products, bookings, SEO
--     content, employee tasks/conversations/messages/integrations) keeps its owner-scoped
--     FOR ALL policies.
--
-- Re-runnable: every policy is dropped by name before it is created, indexes are guarded.

-- ── RLS on tables that never had it (critic-1) ───────────────────────────────
-- Without RLS any role holding a Data API grant could read/write these directly.
alter table public.events enable row level security;
alter table public.wathq_cache enable row level security;
alter table public.platform_settings enable row level security;
alter table public.webhook_events enable row level security;
-- No policies on these four tables on purpose: only the service role (BYPASSRLS) uses them.

-- ── merchants ────────────────────────────────────────────────────────────────
-- Merchant rows are created and billed server-side only (POST /api/merchant/onboarding,
-- Moyasar confirmation, Salla OAuth). No INSERT or DELETE policy for API roles.
drop policy if exists "merchants_self" on public.merchants;
drop policy if exists "merchants_insert_self" on public.merchants;

drop policy if exists "merchants_select_own" on public.merchants;
create policy "merchants_select_own" on public.merchants
  for select to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists "merchants_update_own" on public.merchants;
create policy "merchants_update_own" on public.merchants
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

-- ── invoices (ZATCA: icv / invoice_hash / status must never be client-editable) ──
drop policy if exists "invoices_self" on public.invoices;
drop policy if exists "invoices_select_own" on public.invoices;
create policy "invoices_select_own" on public.invoices
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- ── billing_payments (amount_halalas / status are trusted by payment verification) ──
drop policy if exists "billing_payments_self" on public.billing_payments;
drop policy if exists "billing_payments_select_own" on public.billing_payments;
create policy "billing_payments_select_own" on public.billing_payments
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- ── social_channels (external_id routes inbound Meta webhooks) ────────────────
drop policy if exists "social_channels_self" on public.social_channels;
drop policy if exists "social_channels_select_own" on public.social_channels;
create policy "social_channels_select_own" on public.social_channels
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- ── voice_configs (phone_number routes inbound Twilio calls) ──────────────────
drop policy if exists "voice_configs_self" on public.voice_configs;

drop policy if exists "voice_configs_select_own" on public.voice_configs;
create policy "voice_configs_select_own" on public.voice_configs
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

drop policy if exists "voice_configs_insert_own" on public.voice_configs;
create policy "voice_configs_insert_own" on public.voice_configs
  for insert to authenticated
  with check (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

drop policy if exists "voice_configs_update_own" on public.voice_configs;
create policy "voice_configs_update_own" on public.voice_configs
  for update to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())))
  with check (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- ── ai_employees (hiring, status and billing columns are service-role only) ───
drop policy if exists "employees: merchant owner" on public.ai_employees;

drop policy if exists "ai_employees_select_own" on public.ai_employees;
create policy "ai_employees_select_own" on public.ai_employees
  for select to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

drop policy if exists "ai_employees_update_own" on public.ai_employees;
create policy "ai_employees_update_own" on public.ai_employees
  for update to authenticated
  using (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())))
  with check (merchant_id in (select m.id from public.merchants m where m.owner_user_id = (select auth.uid())));

-- ── ai_employees.updated_at (F13: the status route writes it; 0008 never created it) ──
alter table public.ai_employees
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists ai_employees_set_updated_at on public.ai_employees;
create trigger ai_employees_set_updated_at
  before update on public.ai_employees
  for each row execute function public.set_updated_at();

-- ── Uniqueness of routing keys and single-row-per-merchant tables ─────────────
-- Pre-flight safe: existing duplicates never abort the migration. Where the right row
-- cannot be chosen mechanically the index is skipped with a WARNING (re-run after
-- cleaning up); brand_kits duplicates are onboarding re-runs and are collapsed to the
-- most recently updated kit.

-- One merchant per auth user (getCurrentMerchant() uses maybeSingle on owner_user_id;
-- the onboarding route relies on this to stay idempotent under double submits).
do $$
declare
  v_dupes integer;
begin
  if to_regclass('public.merchants_owner_user_id_key') is null then
    select count(*) into v_dupes
      from (select owner_user_id from public.merchants
             where owner_user_id is not null
             group by owner_user_id having count(*) > 1) d;
    if v_dupes > 0 then
      raise warning 'merchants: % auth user(s) own more than one merchant row; unique index merchants_owner_user_id_key NOT created. Inspect: select owner_user_id, array_agg(id) from public.merchants where owner_user_id is not null group by 1 having count(*) > 1; then re-run this migration.', v_dupes;
    else
      create unique index merchants_owner_user_id_key on public.merchants (owner_user_id);
    end if;
  end if;
end $$;

-- UI-006: POST /api/brand-kit upserts on merchant_id; without a unique index every save failed.
do $$
declare
  v_removed integer;
begin
  if to_regclass('public.brand_kits_merchant_id_key') is null then
    with ranked as (
      select id,
             row_number() over (
               partition by merchant_id
               order by updated_at desc nulls last, id desc
             ) as rn
        from public.brand_kits
       where merchant_id is not null
    )
    delete from public.brand_kits b
     using ranked r
     where b.id = r.id and r.rn > 1;
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
      raise notice 'brand_kits: removed % older duplicate kit(s); kept the most recently updated kit per merchant', v_removed;
    end if;
    create unique index brand_kits_merchant_id_key on public.brand_kits (merchant_id);
  end if;
end $$;

-- F01/F35: one merchant per Twilio number (inbound calls are routed by phone_number).
do $$
declare
  v_dupes integer;
begin
  if to_regclass('public.voice_configs_phone_number_key') is null then
    select count(*) into v_dupes
      from (select phone_number from public.voice_configs
             where phone_number is not null
             group by phone_number having count(*) > 1) d;
    if v_dupes > 0 then
      raise warning 'voice_configs: % phone number(s) are assigned to more than one merchant; unique index voice_configs_phone_number_key NOT created. Inspect: select phone_number, array_agg(merchant_id) from public.voice_configs where phone_number is not null group by 1 having count(*) > 1; then re-run this migration.', v_dupes;
    else
      create unique index voice_configs_phone_number_key
        on public.voice_configs (phone_number)
        where phone_number is not null;
    end if;
  end if;
end $$;

-- F34: one merchant per provider account (Meta inbound webhooks look channels up by
-- (platform, external_id) with maybeSingle; two matches silently dropped the message).
do $$
declare
  v_dupes integer;
begin
  if to_regclass('public.social_channels_platform_external_id_key') is null then
    select count(*) into v_dupes
      from (select platform, external_id from public.social_channels
             where external_id is not null
             group by platform, external_id having count(*) > 1) d;
    if v_dupes > 0 then
      raise warning 'social_channels: % provider account(s) are connected to more than one merchant; unique index social_channels_platform_external_id_key NOT created. Inspect: select platform, external_id, array_agg(merchant_id) from public.social_channels where external_id is not null group by 1, 2 having count(*) > 1; then re-run this migration.', v_dupes;
    else
      create unique index social_channels_platform_external_id_key
        on public.social_channels (platform, external_id)
        where external_id is not null;
    end if;
  end if;
end $$;
