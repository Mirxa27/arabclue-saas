-- arabclue · RLS lock-down (part 2 of 2): explicit Data API privileges.
--
-- Two jobs in one place, so the privilege model is defined exactly once:
--  1. Lock-down (F01): table-level privileges are revoked and only the columns a merchant
--     really edits are re-granted. Column grants only bite once the table-level privilege
--     is gone, and Supabase's legacy defaults granted anon AND authenticated everything
--     (including TRUNCATE/REFERENCES/TRIGGER).
--  2. Baseline (critic-3): Supabase projects default to opt-in Data API grants from
--     2026-10-30 — tables created by the historical migrations get NO grants for anon,
--     authenticated or even service_role on a fresh project/branch/reset. Everything the
--     app needs is granted explicitly here.
--
-- Model:
--   anon           nothing on any app table, sequence or function
--   authenticated  SELECT on merchant-visible tables (RLS still applies), DML only on
--                  merchant-authored content, column-scoped UPDATE/INSERT where listed
--   service_role   full DML on every app table + sequences (server routes, webhooks, cron)
--
-- Every later migration that adds a table/sequence/function must carry its own grants
-- (see 20261106001200_agent_settings.sql for the pattern). Re-runnable: revoke-then-grant.

grant usage on schema public to authenticated, service_role;

-- ── Reset: API roles start from nothing on every pre-existing app table ──────
revoke all on table
  public.merchants, public.brand_kits, public.invoices, public.social_plans,
  public.social_posts, public.wathq_cache, public.events, public.salla_products,
  public.social_channels, public.voice_configs, public.bookings, public.seo_content,
  public.billing_payments, public.platform_settings, public.webhook_events,
  public.ai_employees, public.ai_employee_integrations, public.ai_employee_conversations,
  public.ai_employee_messages, public.ai_employee_tasks, public.ai_employee_actions,
  public.ai_employee_heartbeats
from anon, authenticated;

revoke all on sequence
  public.events_id_seq, public.webhook_events_id_seq, public.ai_employee_actions_id_seq
from anon, authenticated;

-- ── service_role: full DML everywhere (bypasses RLS) ─────────────────────────
grant select, insert, update, delete on table
  public.merchants, public.brand_kits, public.invoices, public.social_plans,
  public.social_posts, public.wathq_cache, public.events, public.salla_products,
  public.social_channels, public.voice_configs, public.bookings, public.seo_content,
  public.billing_payments, public.platform_settings, public.webhook_events,
  public.ai_employees, public.ai_employee_integrations, public.ai_employee_conversations,
  public.ai_employee_messages, public.ai_employee_tasks, public.ai_employee_actions,
  public.ai_employee_heartbeats
to service_role;

grant usage, select on sequence
  public.events_id_seq, public.webhook_events_id_seq, public.ai_employee_actions_id_seq
to service_role;

-- ── authenticated: read what RLS lets the owner see ──────────────────────────
grant select on table
  public.merchants, public.brand_kits, public.invoices, public.social_plans,
  public.social_posts, public.salla_products, public.social_channels,
  public.voice_configs, public.bookings, public.seo_content, public.billing_payments,
  public.ai_employees, public.ai_employee_integrations, public.ai_employee_conversations,
  public.ai_employee_messages, public.ai_employee_tasks, public.ai_employee_actions,
  public.ai_employee_heartbeats
to authenticated;
-- events, wathq_cache, platform_settings, webhook_events: no grant (service role only).

-- Merchant-authored content: owner-scoped DML through the existing FOR ALL policies.
grant insert, update, delete on table
  public.brand_kits, public.social_plans, public.social_posts, public.salla_products,
  public.bookings, public.seo_content, public.ai_employee_integrations,
  public.ai_employee_conversations, public.ai_employee_messages, public.ai_employee_tasks
to authenticated;

-- merchants: profile and consent fields only. plan, subscription_*, billing_cycle_*,
-- owner_user_id, salla_* (routing), access/refresh tokens and zatca_* stay server-side.
grant update (seller_name, vat_number, cr_number, seller_address, store_url,
              dpa_accepted_at, dpa_version)
  on public.merchants to authenticated;

-- voice_configs: the merchant edits the agent settings; phone_number and
-- twilio_incoming_sid (call routing, provisioned numbers) are written by the server.
-- merchant_id is listed because PostgREST upserts SET every payload column; RLS pins it
-- to the caller's own merchant.
grant insert (merchant_id, dialect, hours, escalation_phone, knowledge, enabled, updated_at)
  on public.voice_configs to authenticated;
grant update (merchant_id, dialect, hours, escalation_phone, knowledge, enabled, updated_at)
  on public.voice_configs to authenticated;

-- ai_employees: persona/profile fields only. Hiring (INSERT), status/paused_at/
-- offboarded_at, role_id, hire_plan, merchant_id and every billing column
-- (monthly_charge_halalas, billing_status, trial_ends_at, next_billing_at,
-- last_billing_payment_id) are service-role writes behind the API's billing checks.
-- updated_at is maintained by trigger.
grant update (display_name, avatar, language, tone, timezone, working_hours, knowledge,
              goals, config, updated_at)
  on public.ai_employees to authenticated;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Trigger-only helper: triggers do not need EXECUTE; keep it off the RPC surface.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Webhook claim RPCs (20261106000100) — restated so the baseline is complete.
revoke execute on function public.claim_webhook_event(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_event(text, text, text, integer) to service_role;
revoke execute on function public.prune_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.prune_webhook_events(integer) to service_role;
