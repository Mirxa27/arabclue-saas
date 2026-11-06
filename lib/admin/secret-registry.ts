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
      {
        key: "SUPABASE_SECRET_KEY",
        label: "Supabase secret key (sign-in IP forwarding)",
        required: false,
        type: "secret",
        bootstrap: true,
        hint: "Optional, hPanel only — sb_secret_… key. Sign-in forwards each visitor's IP so Supabase rate-limits per visitor; also enable Authentication → Rate Limits → IP address forwarding"
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
      },
      {
        key: "TRUSTED_PROXY_HOPS",
        label: "Trusted proxy hops (client IP for rate limits)",
        required: false,
        type: "text",
        hint: "Reverse proxies that append X-Forwarded-For. Hostinger/Passenger: 1 (default); Cloudflare → Hostinger: 2; ignored on Vercel"
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
      { key: "SALLA_WEBHOOK_SECRET", label: "Salla webhook secret", required: true, type: "secret" },
      {
        key: "NEXT_PUBLIC_SALLA_INSTALL_URL",
        label: "Salla App Store install link",
        required: false,
        type: "url",
        hint: "Easy Mode (listed apps): when set, \"Connect Salla\" opens this instead of the in-app OAuth flow. Marketing CTAs need a rebuild after changing NEXT_PUBLIC_* keys"
      }
    ]
  },
  {
    id: "meta",
    title: "Meta (Instagram / WhatsApp)",
    description: "OAuth and webhooks for social handover",
    fields: [
      { key: "META_APP_ID", label: "Meta app ID", required: true, type: "text" },
      {
        key: "META_APP_SECRET",
        label: "Meta app secret",
        required: true,
        type: "secret",
        hint: "Verifies X-Hub-Signature-256 on /api/meta/webhook — deliveries are refused (503) while unset"
      },
      { key: "META_REDIRECT_URI", label: "Meta redirect URI", required: false, type: "url" },
      { key: "META_WEBHOOK_VERIFY_TOKEN", label: "Meta webhook verify token", required: true, type: "secret" },
      {
        key: "META_GRAPH_VERSION",
        label: "Meta Graph API version",
        required: false,
        type: "text",
        hint: "e.g. v26.0 — overrides the built-in default in lib/meta/graph.ts for every Graph / Facebook Login call"
      }
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
      {
        key: "SOCIAL_INBOUND_SECRET",
        label: "Social inbound bridge",
        required: false,
        type: "secret",
        hint: "Bearer token for /api/social/inbound; blank falls back to CRON_SECRET"
      }
    ]
  },
  {
    id: "employee_channels",
    title: "AI employee channels",
    description: "Fallback secrets for per-employee channel webhooks (per-integration values take precedence)",
    fields: [
      {
        key: "SLACK_SIGNING_SECRET",
        label: "Slack signing secret (platform Slack app)",
        required: false,
        type: "secret",
        hint: "Verifies Slack events for employees connected through the platform Slack app; events are refused (503) when neither this nor the employee's signing_secret is set"
      },
      {
        key: "WHATSAPP_VERIFY_TOKEN",
        label: "WhatsApp webhook verify token (fallback)",
        required: false,
        type: "secret",
        hint: "Used by the webhook handshake only when an employee's WhatsApp integration has no verify_token"
      }
    ]
  },
  {
    id: "billing",
    title: "Moyasar billing",
    description: "Subscriptions and payment webhooks",
    fields: [
      { key: "MOYASAR_PUBLIC_KEY", label: "Moyasar public key", required: true, type: "text" },
      { key: "MOYASAR_SECRET_KEY", label: "Moyasar secret key", required: true, type: "secret" },
      {
        key: "MOYASAR_WEBHOOK_SECRET",
        label: "Moyasar webhook secret token",
        required: true,
        type: "secret",
        hint: "Must equal the secret token set on the Moyasar webhook — every delivery is refused (503) while unset"
      },
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
    description:
      "E-invoicing environment. Every merchant onboards its own EGS unit in Settings → ZATCA (key and CSIDs stored encrypted per merchant); there is no platform-wide CSID.",
    fields: [
      {
        key: "ZATCA_ENVIRONMENT",
        label: "Fatoora environment",
        required: false,
        type: "text",
        hint: "sandbox (developer portal) | simulation | production — unset: e-invoicing is off and Salla orders wait"
      },
      {
        key: "ZATCA_FATOORA_BASE",
        label: "Fatoora API base (optional override)",
        required: false,
        type: "url",
        hint: "Defaults to https://gw-fatoora.zatca.gov.sa/e-invoicing/{developer-portal|simulation|core}"
      }
    ]
  },
  {
    id: "voice",
    title: "Voice agent",
    description: "Telephony and realtime bridge",
    fields: [
      {
        key: "VOICE_BRIDGE_SECRET",
        label: "Voice bridge secret",
        required: true,
        type: "secret",
        hint: "Bearer token the telephony bridge sends to /api/voice/webhook (503 while unset)"
      },
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio account SID", required: false, type: "text" },
      {
        key: "TWILIO_AUTH_TOKEN",
        label: "Twilio auth token",
        required: false,
        type: "secret",
        hint: "Also verifies X-Twilio-Signature on /api/voice/twilio/inbound — calls are refused while unset"
      },
      {
        key: "VOICE_BRIDGE_WS_URL",
        label: "Realtime media stream URL",
        required: false,
        type: "url",
        hint: "wss:// URL of the media bridge. Required (with the bridge secret) before numbers can be bought or the voice agent switched on; calls are not bridged while unset"
      }
    ]
  },
  {
    id: "wathq",
    title: "Wathq",
    description: "Commercial registry enrichment",
    fields: [{ key: "WATHQ_API_KEY", label: "Wathq API key", required: false, type: "secret" }]
  },
  {
    id: "company",
    title: "Company",
    description: "arabclue's own registration details shown on the public /maroof page",
    fields: [
      {
        key: "COMPANY_CR_NUMBER",
        label: "Commercial registration (CR) number",
        required: false,
        type: "text",
        hint: "10 digits, shown on /maroof. Read per request — no rebuild needed; while unset the page shows a neutral 'coming soon' line"
      },
      {
        key: "MAROOF_URL",
        label: "Maroof profile URL",
        required: false,
        type: "url",
        hint: "https link to arabclue's Maroof profile, shown on /maroof"
      }
    ]
  },
  {
    id: "email",
    title: "Email (Resend)",
    description: "Transactional email: support acknowledgements, ticket relay, AI-employee email channel",
    fields: [
      { key: "RESEND_API_KEY", label: "Resend API key", required: false, type: "secret" },
      { key: "EMAIL_FROM", label: "Default sender address", required: false, type: "text", hint: "e.g. arabclue <hello@arabclue.com> — the domain must be verified in Resend" },
      { key: "SUPPORT_FROM_EMAIL", label: "Support sender address", required: false, type: "text", hint: "Falls back to EMAIL_FROM, then support@arabclue.com" },
      { key: "SUPPORT_REPLY_TO", label: "Support reply-to address", required: false, type: "text" },
      { key: "SUPPORT_INBOX_EMAIL", label: "Support inbox (ticket relay)", required: false, type: "text", hint: "New support tickets are forwarded here" }
    ]
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
