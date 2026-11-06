/** Shared database row types — mirrors supabase/migrations schema. */

export type MerchantPlan = "lite" | "plus" | "pro" | "enterprise";

export type SellerAddress = {
  street: string;
  building: string;
  city: string;
  postalCode: string;
  district?: string;
};

/**
 * public.merchants as the signed-in owner reads it: exactly the columns authenticated may SELECT
 * (lib/merchant/columns.ts, supabase/migrations/20261106007000_merchants_client_columns.sql).
 * This is what getCurrentMerchant / getSessionContext / useMerchant return and what pages render.
 *
 * Through the Data API a merchant may only UPDATE seller_name, vat_number, cr_number,
 * seller_address, store_url, dpa_accepted_at and dpa_version (20261106001100_api_grants.sql);
 * plan, subscription_*, salla_* and zatca_* are written server-side with the service role.
 * Credentials are not part of this type: see MerchantSecrets.
 */
export type Merchant = {
  id: string;
  salla_merchant_id: string | null;
  salla_store_name?: string | null;
  store_url: string | null;
  store_name?: string | null;
  name?: string | null;
  email?: string | null;
  seller_name: string | null;
  vat_number: string | null;
  cr_number: string | null;
  seller_address: SellerAddress | null;
  token_expires_at: string | null;
  salla_token_invalid_at?: string | null;
  plan: MerchantPlan;
  subscription_status?: "pending" | "active" | "past_due" | "canceled";
  subscription_expires_at?: string | null;
  billing_cycle_started_at?: string | null;
  owner_user_id: string | null;
  zatca_onboarded_at: string | null;
  installed_at: string | null;
  uninstalled_at: string | null;
  dpa_accepted_at?: string | null;
  dpa_version?: string | null;
};

/**
 * Service-role only merchants columns (MERCHANT_SECRET_COLUMNS): Salla OAuth tokens (enc:v1:
 * ciphertext), the token-refresh lease and the ZATCA credentials. `authenticated` cannot SELECT
 * them; read them only with getServiceSupabase() in server code (lib/salla/tokens.ts,
 * lib/merchant/secrets.ts) and never pass them to a client component.
 */
export type MerchantSecrets = {
  salla_state: string | null;
  access_token: string | null;
  refresh_token: string | null;
  salla_refresh_lease?: string | null;
  salla_refresh_lease_until?: string | null;
  zatca_csid: string | null;
  zatca_private_key_encrypted?: string | null;
};

/** A full merchants row, as only the service role can read it. */
export type MerchantRow = Merchant & MerchantSecrets;

/**
 * generated: signed, not yet accepted by ZATCA · reported: simplified, accepted (REPORTED) ·
 * cleared: standard, accepted (CLEARED; cleared_xml is the legal document) · rejected: ZATCA
 * validation errors (reissue a corrected document) · failed: not delivered (retried) ·
 * submitted: legacy.
 */
export type InvoiceStatus = "generated" | "submitted" | "reported" | "cleared" | "rejected" | "failed";

export type InvoiceSummary = {
  id: string;
  invoice_number: string;
  total: number | null;
  status: InvoiceStatus;
  created_at: string;
};

export type Invoice = InvoiceSummary & {
  merchant_id: string;
  salla_order_id: string | null;
  uuid: string;
  icv: number;
  invoice_hash: string;
  qr_base64: string;
  xml: string;
  subtotal: number | null;
  vat: number | null;
  fatoora_response: Record<string, unknown> | null;
  /** Phase-2 columns (20261106003500_zatca_phase2.sql); null on invoices issued before it. */
  invoice_type?: "standard" | "simplified" | null;
  document_type?: "invoice" | "credit_note" | "debit_note";
  environment?: "sandbox" | "simulation" | "production" | null;
  previous_invoice_hash?: string | null;
  issued_at?: string | null;
  buyer_name?: string | null;
  buyer_vat_number?: string | null;
  cleared_xml?: string | null;
  validation_warnings?: Array<{ code?: string; category?: string; message?: string }> | null;
  validation_errors?: Array<{ code?: string; category?: string; message?: string }> | null;
  submitted_at?: string | null;
  submission_attempts?: number;
  superseded_by?: string | null;
  reissue_of?: string | null;
  status_note?: string | null;
};

export type SocialPostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "canceled";

export type SocialPostSummary = {
  id: string;
  hook: string;
  platforms: string[];
  scheduled_for: string;
  status: SocialPostStatus;
  goal?: string;
};

export type SallaProduct = {
  id: string;
  merchant_id: string;
  salla_product_id: string;
  name: string;
  arabic_name: string | null;
  description: string | null;
  price: number | null;
  category: string | null;
  image_url: string | null;
  url: string | null;
  inventory: number | null;
  updated_at: string | null;
};

export type SeoContentKind = "product" | "blog" | "meta";

export type SeoContent = {
  id: string;
  merchant_id: string;
  kind: SeoContentKind;
  ref_id: string | null;
  payload: {
    title?: string;
    metaDescription?: string;
    description?: string;
    slug?: string;
  };
  published: boolean;
  created_at: string;
};

export type VoiceDialect = "khaliji" | "msa";

export type VoiceConfig = {
  merchant_id: string;
  dialect: VoiceDialect;
  hours: string | null;
  escalation_phone: string | null;
  knowledge: string | null;
  /** Service-role only: provisioned Twilio number that inbound calls are routed by. */
  phone_number: string | null;
  twilio_incoming_sid?: string | null;
  /** Set while POST /api/voice/provision-number holds the purchase reservation. */
  provisioning_started_at?: string | null;
  enabled: boolean;
  updated_at: string | null;
};

export type BookingStatus = "new" | "confirmed" | "done" | "canceled";

export type Booking = {
  id: string;
  merchant_id: string;
  name: string;
  mobile: string;
  preferred_time: string | null;
  note: string | null;
  source: "voice" | "social" | "web";
  status: BookingStatus;
  created_at: string;
};

export type BrandKitDialect = "khaliji" | "msa" | "english";

export type BrandKit = {
  id?: string;
  merchant_id?: string;
  brand_name: string;
  essence: string | null;
  attributes: string[];
  favor_words: string[];
  avoid_words: string[];
  dialect: BrandKitDialect;
  updated_at?: string | null;
};

export type SeoSiteAudit = {
  status: "idle" | "scanning" | "done" | "error";
  issues: Array<{
    severity: "critical" | "warning" | "ok";
    title: string;
    detail: string;
    url?: string;
  }>;
  scanned_at?: string | null;
  score?: number | null;
};

export type VoiceCallLog = {
  id: string;
  merchant_id: string;
  caller_number: string;
  caller_name?: string | null;
  duration_seconds: number;
  transcript?: string | null;
  summary?: string | null;
  booking_id?: string | null;
  direction: "inbound" | "outbound";
  status: "completed" | "missed" | "voicemail" | "failed";
  created_at: string;
};
