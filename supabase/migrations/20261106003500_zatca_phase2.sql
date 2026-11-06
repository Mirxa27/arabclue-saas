-- arabclue · ZATCA Phase 2: EGS units, the per-merchant invoice chain, Phase-2 invoice columns
-- (F14, F09, critic-24)
--
-- 1. zatca_egs_units — one E-invoice Generation Solution unit per merchant: the secp256k1 private
--    key, the compliance CSID (token + secret + request id) and the production CSID, all enc:v1:
--    ciphertext (lib/crypto/secrets.ts, TOKEN_ENCRYPTION_KEY) — enforced by CHECK constraints so
--    plaintext can never be stored. RLS on, NO grants to anon/authenticated: service role only. The
--    UI gets the non-secret status (environment, step, certificate expiry) from GET /api/zatca/onboard.
--
-- 2. zatca_chain_heads — the head of each merchant's document chain (last ICV + hash). Its row is
--    the per-merchant lock of zatca_append_invoice().
--
-- 3. invoices — Phase-2 columns (type, environment, PIH, cleared XML, ZATCA validation results,
--    supersession), status 'reported' (simplified documents are reported, standard ones cleared),
--    and one live invoice per Salla order: a partial unique index on (merchant_id, salla_order_id)
--    WHERE salla_order_id IS NOT NULL AND superseded_by IS NULL. Existing duplicates (the F08/F09
--    webhook races) never abort the migration — critic-24 remediation, applied here:
--      * the earliest invoice of the order is kept;
--      * every later one gets superseded_by = the kept invoice and a status_note; unreported extras
--        (generated / failed / rejected) are marked 'failed' (rejected stays rejected) — nothing to do;
--      * extras already reported to ZATCA (submitted / reported / cleared) keep their status — they
--        are legal records that must not be deleted or renumbered — and are listed in a WARNING:
--        issue a credit note for each (status_note says so; the dashboard shows it).
--
-- 4. zatca_append_invoice() — atomic ICV + previous-hash allocation: under the merchant's head-row
--    lock it checks that the caller signed the document with ICV = head + 1 and PIH = head hash
--    (the ZATCA genesis hash for the first document of an environment), refuses a second live
--    invoice for the same Salla order, inserts the invoice and advances the head — all in one
--    transaction. A caller whose head is stale gets 'head_moved' with the current head, re-signs and
--    retries; the chain can never fork or reuse an ICV. Service role only.
--
-- 5. merchants.zatca_onboarded_at is cleared where no active EGS unit exists: the previous flow
--    requested CSIDs for a CSR whose private key arabclue never held, so those merchants cannot sign
--    Phase-2 invoices and must onboard again (merchants.zatca_csid is no longer read).
--
-- Asserted by supabase/tests/45_zatca_chain.test.sql, 46_zatca_privileges.test.sql and
-- supabase/tests/preflight/20261106003500_invoice_duplicates.*. Re-runnable.

-- ── 1. EGS units ─────────────────────────────────────────────────────────────
create table if not exists public.zatca_egs_units (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  environment text not null,
  status text not null,
  common_name text not null,
  egs_serial_number text not null,
  invoice_types text not null default '1100',
  csr_pem text not null,
  private_key_encrypted text not null,
  compliance_token_encrypted text,
  compliance_secret_encrypted text,
  compliance_request_id_encrypted text,
  compliance_checks jsonb not null default '{}'::jsonb,
  production_token_encrypted text,
  production_secret_encrypted text,
  certificate_serial text,
  certificate_issuer text,
  certificate_not_after timestamptz,
  last_error jsonb,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zatca_egs_units_environment check (environment in ('sandbox', 'simulation', 'production')),
  constraint zatca_egs_units_status check (status in ('compliance_issued', 'compliance_passed', 'active')),
  constraint zatca_egs_units_invoice_types check (invoice_types ~ '^[01]{4}$' and invoice_types <> '0000'),
  constraint zatca_egs_units_key_encrypted check (private_key_encrypted like 'enc:v1:%'),
  constraint zatca_egs_units_compliance_encrypted check (
    (compliance_token_encrypted is null or compliance_token_encrypted like 'enc:v1:%')
    and (compliance_secret_encrypted is null or compliance_secret_encrypted like 'enc:v1:%')
    and (compliance_request_id_encrypted is null or compliance_request_id_encrypted like 'enc:v1:%')
  ),
  constraint zatca_egs_units_production_encrypted check (
    (production_token_encrypted is null or production_token_encrypted like 'enc:v1:%')
    and (production_secret_encrypted is null or production_secret_encrypted like 'enc:v1:%')
  ),
  constraint zatca_egs_units_active_has_csid check (
    status <> 'active' or (production_token_encrypted is not null and production_secret_encrypted is not null)
  )
);

alter table public.zatca_egs_units enable row level security;
revoke all on table public.zatca_egs_units from anon, authenticated;
grant select, insert, update, delete on table public.zatca_egs_units to service_role;

drop trigger if exists zatca_egs_units_set_updated_at on public.zatca_egs_units;
create trigger zatca_egs_units_set_updated_at
  before update on public.zatca_egs_units
  for each row execute function public.set_updated_at();

-- ── 2. chain heads ───────────────────────────────────────────────────────────
create table if not exists public.zatca_chain_heads (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  last_icv integer not null default 0,
  -- null: the next document starts the chain (ZATCA genesis PIH)
  last_hash text,
  last_invoice_id uuid,
  environment text,
  updated_at timestamptz not null default now(),
  constraint zatca_chain_heads_icv check (last_icv >= 0),
  constraint zatca_chain_heads_environment check (environment is null or environment in ('sandbox', 'simulation', 'production'))
);

alter table public.zatca_chain_heads enable row level security;
revoke all on table public.zatca_chain_heads from anon, authenticated;
grant select, insert, update, delete on table public.zatca_chain_heads to service_role;

-- ── 3. invoices ──────────────────────────────────────────────────────────────
alter table public.invoices
  add column if not exists invoice_type text,
  add column if not exists document_type text not null default 'invoice',
  add column if not exists environment text,
  add column if not exists previous_invoice_hash text,
  add column if not exists issued_at timestamptz,
  add column if not exists buyer_name text,
  add column if not exists buyer_vat_number text,
  add column if not exists cleared_xml text,
  add column if not exists validation_warnings jsonb,
  add column if not exists validation_errors jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists submission_attempts integer not null default 0,
  add column if not exists superseded_by uuid,
  add column if not exists reissue_of uuid,
  add column if not exists status_note text,
  -- what the document was built from (lines, buyer, references) — reissuing a rejected document
  add column if not exists issue_input jsonb,
  add column if not exists updated_at timestamptz;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('generated', 'submitted', 'reported', 'cleared', 'rejected', 'failed'));

alter table public.invoices drop constraint if exists invoices_invoice_type_check;
alter table public.invoices add constraint invoices_invoice_type_check
  check (invoice_type is null or invoice_type in ('standard', 'simplified'));

alter table public.invoices drop constraint if exists invoices_document_type_check;
alter table public.invoices add constraint invoices_document_type_check
  check (document_type in ('invoice', 'credit_note', 'debit_note'));

alter table public.invoices drop constraint if exists invoices_environment_check;
alter table public.invoices add constraint invoices_environment_check
  check (environment is null or environment in ('sandbox', 'simulation', 'production'));

do $$ begin
  alter table public.invoices add constraint invoices_superseded_by_fkey
    foreign key (superseded_by) references public.invoices(id) on delete set null deferrable initially deferred;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.invoices add constraint invoices_reissue_of_fkey
    foreign key (reissue_of) references public.invoices(id) on delete set null;
exception when duplicate_object then null;
end $$;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index if not exists invoices_merchant_status_idx on public.invoices (merchant_id, status, created_at desc);
create index if not exists invoices_submission_retry_idx on public.invoices (status, created_at)
  where status in ('generated', 'failed', 'submitted') and superseded_by is null;

-- critic-24: one live invoice per Salla order. Pre-flight + remediation first (never aborts).
do $$
declare
  grp record;
  kept record;
  reported_extras text[] := '{}';
  remediated integer := 0;
begin
  for grp in
    select merchant_id, salla_order_id
    from public.invoices
    where salla_order_id is not null and superseded_by is null
    group by merchant_id, salla_order_id
    having count(*) > 1
  loop
    select id, invoice_number into kept
    from public.invoices
    where merchant_id is not distinct from grp.merchant_id and salla_order_id = grp.salla_order_id and superseded_by is null
    order by created_at asc nulls last, icv asc
    limit 1;

    reported_extras := reported_extras || array(
      select format('%s (merchant %s, order %s, status %s)', i.invoice_number, i.merchant_id, i.salla_order_id, i.status)
      from public.invoices i
      where i.merchant_id is not distinct from grp.merchant_id and i.salla_order_id = grp.salla_order_id
        and i.superseded_by is null and i.id <> kept.id and i.status in ('submitted', 'reported', 'cleared')
    );

    update public.invoices i
    set superseded_by = kept.id,
        status = case when i.status in ('generated', 'failed') then 'failed' else i.status end,
        status_note = case
          when i.status in ('submitted', 'reported', 'cleared') then format(
            'Duplicate of %s for Salla order %s (concurrent webhook delivery). It was already sent to ZATCA: issue a credit note for it.',
            kept.invoice_number, grp.salla_order_id)
          else format(
            'Duplicate of %s for Salla order %s (concurrent webhook delivery); never accepted by ZATCA — no action needed.',
            kept.invoice_number, grp.salla_order_id)
        end
    where i.merchant_id is not distinct from grp.merchant_id and i.salla_order_id = grp.salla_order_id
      and i.superseded_by is null and i.id <> kept.id;
    get diagnostics remediated = row_count;
  end loop;

  if array_length(reported_extras, 1) > 0 then
    raise warning 'invoices: % duplicate Salla-order invoice(s) were already sent to ZATCA and need a credit note: %',
      array_length(reported_extras, 1), array_to_string(reported_extras, '; ');
  end if;
end $$;

create unique index if not exists invoices_merchant_salla_order_live_uidx
  on public.invoices (merchant_id, salla_order_id)
  where salla_order_id is not null and superseded_by is null;

-- ── 4. atomic append ─────────────────────────────────────────────────────────
create or replace function public.zatca_append_invoice(
  p_merchant_id uuid,
  p_icv integer,
  p_previous_hash text,
  p_environment text,
  p_invoice jsonb,
  p_supersedes uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  genesis constant text := 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
  head public.zatca_chain_heads%rowtype;
  expected_pih text;
  new_id uuid := gen_random_uuid();
  existing uuid;
  order_id text := nullif(btrim(coalesce(p_invoice ->> 'salla_order_id', '')), '');
begin
  if p_merchant_id is null or p_icv is null or p_previous_hash is null then
    raise exception 'zatca_append_invoice: merchant, icv and previous hash are required' using errcode = '22023';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'simulation', 'production') then
    raise exception 'zatca_append_invoice: unknown environment %', p_environment using errcode = '22023';
  end if;
  if coalesce(p_invoice ->> 'invoice_hash', '') = '' or coalesce(p_invoice ->> 'xml', '') = ''
     or coalesce(p_invoice ->> 'uuid', '') = '' or coalesce(p_invoice ->> 'invoice_number', '') = ''
     or coalesce(p_invoice ->> 'qr_base64', '') = '' then
    raise exception 'zatca_append_invoice: invoice_number, uuid, invoice_hash, qr_base64 and xml are required' using errcode = '22023';
  end if;

  -- The head row is the per-merchant lock. Created on first use; it continues the ICVs of invoices
  -- issued before this migration (unique (merchant_id, icv)) and starts a fresh PIH chain.
  insert into public.zatca_chain_heads (merchant_id, last_icv, last_hash, environment)
  select p_merchant_id, coalesce(max(i.icv), 0), null, null
  from public.invoices i
  where i.merchant_id = p_merchant_id
  on conflict (merchant_id) do nothing;

  select * into head from public.zatca_chain_heads where merchant_id = p_merchant_id for update;

  expected_pih := case
    when head.last_hash is null or head.environment is distinct from p_environment then genesis
    else head.last_hash
  end;
  if p_icv <> head.last_icv + 1 or p_previous_hash <> expected_pih then
    return jsonb_build_object('outcome', 'head_moved', 'icv', head.last_icv + 1, 'previous_hash', expected_pih);
  end if;

  if order_id is not null then
    select i.id into existing
    from public.invoices i
    where i.merchant_id = p_merchant_id and i.salla_order_id = order_id and i.superseded_by is null
      and (p_supersedes is null or i.id <> p_supersedes)
    limit 1;
    if existing is not null then
      return jsonb_build_object('outcome', 'duplicate_order', 'id', existing);
    end if;
  end if;

  if p_supersedes is not null then
    update public.invoices
    set superseded_by = new_id,
        status_note = format('Rejected by ZATCA; reissued as %s (ICV %s).', p_invoice ->> 'invoice_number', p_icv)
    where id = p_supersedes and merchant_id = p_merchant_id and status = 'rejected' and superseded_by is null;
    if not found then
      return jsonb_build_object('outcome', 'not_supersedable');
    end if;
  end if;

  insert into public.invoices (
    id, merchant_id, salla_order_id, invoice_number, uuid, icv, invoice_hash, previous_invoice_hash,
    qr_base64, xml, subtotal, vat, total, status, invoice_type, document_type, environment,
    issued_at, buyer_name, buyer_vat_number, issue_input, reissue_of, created_at
  ) values (
    new_id, p_merchant_id, order_id, p_invoice ->> 'invoice_number', (p_invoice ->> 'uuid')::uuid, p_icv,
    p_invoice ->> 'invoice_hash', p_previous_hash, p_invoice ->> 'qr_base64', p_invoice ->> 'xml',
    (p_invoice ->> 'subtotal')::numeric, (p_invoice ->> 'vat')::numeric, (p_invoice ->> 'total')::numeric,
    'generated', p_invoice ->> 'invoice_type', coalesce(p_invoice ->> 'document_type', 'invoice'), p_environment,
    (p_invoice ->> 'issued_at')::timestamptz, p_invoice ->> 'buyer_name', p_invoice ->> 'buyer_vat_number',
    p_invoice -> 'issue_input', p_supersedes, now()
  );

  update public.zatca_chain_heads
  set last_icv = p_icv, last_hash = p_invoice ->> 'invoice_hash', last_invoice_id = new_id,
      environment = p_environment, updated_at = now()
  where merchant_id = p_merchant_id;

  return jsonb_build_object('outcome', 'inserted', 'id', new_id);
end;
$$;

revoke execute on function public.zatca_append_invoice(uuid, integer, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.zatca_append_invoice(uuid, integer, text, text, jsonb, uuid) to service_role;

-- ── 5. onboarding flag ───────────────────────────────────────────────────────
update public.merchants m
set zatca_onboarded_at = null
where m.zatca_onboarded_at is not null
  and not exists (select 1 from public.zatca_egs_units e where e.merchant_id = m.id and e.status = 'active');

notify pgrst, 'reload schema';
