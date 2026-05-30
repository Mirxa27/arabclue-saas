/** Shared database row types — mirrors supabase/migrations schema. */

export type MerchantPlan = "lite" | "plus" | "pro" | "enterprise";

export type SellerAddress = {
  street: string;
  building: string;
  city: string;
  postalCode: string;
  district?: string;
};

export type Merchant = {
  id: string;
  salla_merchant_id: string | null;
  salla_state: string | null;
  store_url: string | null;
  store_name?: string | null;
  name?: string | null;
  email?: string | null;
  seller_name: string | null;
  vat_number: string | null;
  cr_number: string | null;
  seller_address: SellerAddress | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  plan: MerchantPlan;
  subscription_status?: "pending" | "active" | "past_due" | "canceled";
  subscription_expires_at?: string | null;
  billing_cycle_started_at?: string | null;
  owner_user_id: string | null;
  zatca_csid: string | null;
  zatca_onboarded_at: string | null;
  installed_at: string | null;
  uninstalled_at: string | null;
  dpa_accepted_at?: string | null;
  dpa_version?: string | null;
};

export type InvoiceStatus = "generated" | "submitted" | "cleared" | "rejected" | "failed";

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
};

export type SocialPostStatus = "scheduled" | "publishing" | "published" | "failed" | "canceled";

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
  phone_number: string | null;
  twilio_incoming_sid?: string | null;
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
