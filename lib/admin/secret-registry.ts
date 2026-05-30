/**
 * Registry of platform secrets manageable from /admin/config.
 * Bootstrap keys must remain in server env (hPanel) to cold-start Supabase + decryption.
 */

export type SecretFieldType = "secret" | "text" | "url" | "emails";

export type SecretFieldDef = {
  key: string;
  label: string;
  required: boolean;
  type: SecretFieldType;
  /** Only configurable via hPanel / server .env — shown read-only in admin */
  bootstrap?: boolean;
  hint?: string;
};

export type SecretGroupDef = {
  id: string;
  title: string;
  description: string;
  fields: SecretFieldDef[];
};

export const BOOTSTRAP_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY"
] as const;

export const SECRET_GROUPS: SecretGroupDef[] = [
  {
    id: "core",
    title: "Core",
    description: "Site URL, cron auth, OAuth signing, and platform operators",
    fields: [
      { key: "NEXT_PUBLIC_SITE_URL", label: "Public site URL", required: true, type: "url" },
      {
        key: "NEXT_PUBLIC_SUPABASE_URL",
        label: "Supabase URL",
        required: true,
        type: "url",
        bootstrap: true,
        hint: "hPanel only — required before admin secrets load"
      },
      {
        key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        label: "Supabase anon key",
        required: true,
        type: "secret",
        bootstrap: true
      },
      {
        key: "SUPABASE_SERVICE_ROLE_KEY",
        label: "Supabase service role",
        required: true,
        type: "secret",
        bootstrap: true
      },
      { key: "CRON_SECRET", label: "Cron / inbound secret", required: true, type: "secret" },
      { key: "OAUTH_STATE_SECRET", label: "OAuth state signing", required: false, type: "secret" },
      {
        key: "TOKEN_ENCRYPTION_KEY",
        label: "Token encryption key (32+ chars)",
        required: true,
        type: "secret",
        bootstrap: true,
        hint: "hPanel only — encrypts secrets saved in admin"
      },
      {
        key: "PLATFORM_ADMIN_EMAILS",
        label: "Platform admin emails (comma-separated)",
        required: false,
        type: "emails"
      }
    ]
  },
  {
    id: "ai",
    title: "AI providers",
    description: "Social planner, voice, SEO, and engager models",
    fields: [
      { key: "OPENAI_API_KEY", label: "OpenAI API key", required: true, type: "secret" },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", required: false, type: "secret" },
      { key: "HUMAIN_API_BASE", label: "HUMAIN base URL (KSA)", required: false, type: "url" },
      { key: "HUMAIN_API_KEY", label: "HUMAIN API key", required: false, type: "secret" }
    ]
  },
  {
    id: "salla",
    title: "Salla",
    description: "Store OAuth, products, and webhooks",
    fields: [
      { key: "SALLA_CLIENT_ID", label: "Salla client ID", required: true, type: "text" },
      { key: "SALLA_CLIENT_SECRET", label: "Salla client secret", required: true, type: "secret" },
      { key: "SALLA_REDIRECT_URI", label: "Salla redirect URI", required: true, type: "url" },
      { key: "SALLA_WEBHOOK_SECRET", label: "Salla webhook secret", required: true, type: "secret" }
    ]
  },
  {
    id: "meta",
    title: "Meta (Instagram / WhatsApp)",
    description: "OAuth and webhooks for social handover",
    fields: [
      { key: "META_APP_ID", label: "Meta app ID", required: true, type: "text" },
      { key: "META_APP_SECRET", label: "Meta app secret", required: true, type: "secret" },
      { key: "META_REDIRECT_URI", label: "Meta redirect URI", required: false, type: "url" },
      { key: "META_WEBHOOK_VERIFY_TOKEN", label: "Meta webhook verify token", required: true, type: "secret" }
    ]
  },
  {
    id: "social_oauth",
    title: "Social OAuth",
    description: "LinkedIn, X, and TikTok developer apps",
    fields: [
      { key: "LINKEDIN_CLIENT_ID", label: "LinkedIn client ID", required: true, type: "text" },
      { key: "LINKEDIN_CLIENT_SECRET", label: "LinkedIn client secret", required: true, type: "secret" },
      { key: "X_CLIENT_ID", label: "X client ID", required: true, type: "text" },
      { key: "X_CLIENT_SECRET", label: "X client secret", required: true, type: "secret" },
      { key: "TIKTOK_CLIENT_KEY", label: "TikTok client key", required: true, type: "text" },
      { key: "TIKTOK_CLIENT_SECRET", label: "TikTok client secret", required: true, type: "secret" },
      { key: "SOCIAL_INBOUND_SECRET", label: "Social inbound bridge", required: false, type: "secret" }
    ]
  },
  {
    id: "billing",
    title: "Moyasar billing",
    description: "Subscriptions and payment webhooks",
    fields: [
      { key: "MOYASAR_PUBLIC_KEY", label: "Moyasar public key", required: true, type: "text" },
      { key: "MOYASAR_SECRET_KEY", label: "Moyasar secret key", required: true, type: "secret" },
      { key: "MOYASAR_WEBHOOK_SECRET", label: "Moyasar webhook secret", required: false, type: "secret" },
      {
        key: "NEXT_PUBLIC_MOYASAR_PUBLIC_KEY",
        label: "Moyasar public key (client checkout)",
        required: false,
        type: "text",
        hint: "Rebuild deploy after changing NEXT_PUBLIC_* keys"
      }
    ]
  },
  {
    id: "zatca",
    title: "ZATCA / Fatoora",
    description: "E-invoicing compliance",
    fields: [
      { key: "ZATCA_FATOORA_BASE", label: "Fatoora API base", required: false, type: "url" },
      { key: "ZATCA_CSID", label: "Platform CSID fallback", required: false, type: "secret" },
      { key: "ZATCA_PRIVATE_KEY_PEM", label: "Platform private key PEM", required: false, type: "secret" }
    ]
  },
  {
    id: "voice",
    title: "Voice agent",
    description: "Telephony and realtime bridge",
    fields: [
      { key: "VOICE_BRIDGE_SECRET", label: "Voice bridge secret", required: true, type: "secret" },
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio account SID", required: false, type: "text" },
      { key: "TWILIO_AUTH_TOKEN", label: "Twilio auth token", required: false, type: "secret" },
      { key: "VOICE_BRIDGE_WS_URL", label: "Realtime media stream URL", required: false, type: "url" }
    ]
  },
  {
    id: "wathq",
    title: "Wathq",
    description: "Commercial registry enrichment",
    fields: [{ key: "WATHQ_API_KEY", label: "Wathq API key", required: false, type: "secret" }]
  }
];

export const MANAGED_SECRET_KEYS = SECRET_GROUPS.flatMap((g) =>
  g.fields.filter((f) => !f.bootstrap).map((f) => f.key)
);

export function getSecretField(key: string): SecretFieldDef | undefined {
  for (const group of SECRET_GROUPS) {
    const field = group.fields.find((f) => f.key === key);
    if (field) return field;
  }
  return undefined;
}

export function isBootstrapSecretKey(key: string): boolean {
  return (BOOTSTRAP_ENV_KEYS as readonly string[]).includes(key);
}
