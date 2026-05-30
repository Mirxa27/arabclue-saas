/**
 * OAuth provider registry for employee integrations.
 *
 * Each provider defines:
 *   • the authorize URL builder (with scopes)
 *   • the token-exchange function (server-side, exchange code for tokens)
 *   • the user-info function (optional, to derive an external_id label)
 *   • PKCE support flag
 *
 * Add a provider here, set the matching env vars, and you get a Connect-with-X
 * button in the workspace for free.
 *
 * Env vars used (all optional — only set the ones you support):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET     → gmail, gcal, google_drive, google_analytics, google_ads
 *   META_APP_ID / META_APP_SECRET               → whatsapp, instagram, meta (Facebook Pages)
 *   LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET → linkedin
 *   SLACK_CLIENT_ID / SLACK_CLIENT_SECRET       → slack
 *   HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET   → hubspot
 *   NOTION_CLIENT_ID / NOTION_CLIENT_SECRET     → notion
 *   X_CLIENT_ID / X_CLIENT_SECRET               → x
 *   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET    → tiktok
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET     → github
 *   STRIPE_CLIENT_ID                            → stripe (Connect)
 *   QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET → quickbooks
 *   XERO_CLIENT_ID / XERO_CLIENT_SECRET         → xero
 *   INTERCOM_CLIENT_ID / INTERCOM_CLIENT_SECRET → intercom
 *   ZENDESK_CLIENT_ID / ZENDESK_CLIENT_SECRET   → zendesk
 *   MAILCHIMP_CLIENT_ID / MAILCHIMP_CLIENT_SECRET → mailchimp
 *
 * Telegram and Salla are not OAuth (Telegram = bot token; Salla = its own flow).
 */

import type { IntegrationKind } from "@/lib/employees/types";

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  /** Provider-specific extra payload kept for callsites that need it. */
  raw?: Record<string, unknown>;
};

export interface OAuthProvider {
  kind: IntegrationKind;
  label: string;
  brandColor: string;
  scopes: string[];
  usesPkce: boolean;
  /** Resolve env vars to a configured client id; null if not configured. */
  clientId(): string | null;
  clientSecret(): string | null;
  /** Build the URL to redirect the user to. */
  authorizeUrl(args: { state: string; redirectUri: string; codeChallenge?: string }): string;
  /** Exchange auth code for tokens. */
  exchange(args: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthTokens>;
  /** Optional: derive a human-readable external_id for the integration row. */
  identify?(tokens: OAuthTokens): Promise<{ externalId: string; label: string } | null>;
}

// ─── shared helpers ────────────────────────────────────────────────────────

async function postForm(
  url: string,
  params: Record<string, string>,
  headers?: Record<string, string>
): Promise<OAuthTokens> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...(headers ?? {})
    },
    body
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error_description as string) ?? (json.error as string) ?? res.statusText;
    throw new Error(`OAuth exchange failed: ${msg}`);
  }
  return {
    access_token: String(json.access_token ?? ""),
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : undefined,
    token_type: typeof json.token_type === "string" ? json.token_type : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
    raw: json
  };
}

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function qs(params: Record<string, string | undefined>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out.append(k, v);
  }
  return out.toString();
}

// ─── providers ─────────────────────────────────────────────────────────────

const google = (kind: IntegrationKind, scopes: string[], label: string): OAuthProvider => ({
  kind,
  label,
  brandColor: "#EA4335",
  scopes,
  usesPkce: false,
  clientId: () => env("GOOGLE_CLIENT_ID"),
  clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
  authorizeUrl({ state, redirectUri }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs({
      client_id: env("GOOGLE_CLIENT_ID") ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: scopes.join(" "),
      state
    })}`;
  },
  async exchange({ code, redirectUri }) {
    return postForm("https://oauth2.googleapis.com/token", {
      code,
      client_id: env("GOOGLE_CLIENT_ID") ?? "",
      client_secret: env("GOOGLE_CLIENT_SECRET") ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
  },
  async identify(tokens) {
    if (!tokens.access_token) return null;
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` }
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { email?: string; sub?: string; name?: string };
    return { externalId: j.email ?? j.sub ?? "google", label: j.email ?? j.name ?? "google" };
  }
});

const PROVIDERS: OAuthProvider[] = [
  google(
    "gmail",
    ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify"],
    "Gmail"
  ),
  google(
    "gcal",
    [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events"
    ],
    "Google Calendar"
  ),
  google(
    "google_drive",
    ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    "Google Drive"
  ),
  google(
    "google_analytics",
    ["openid", "email", "https://www.googleapis.com/auth/analytics.readonly"],
    "Google Analytics"
  ),
  google(
    "google_ads",
    ["openid", "email", "https://www.googleapis.com/auth/adwords"],
    "Google Ads"
  ),

  // ─── Meta (WhatsApp Cloud API + Instagram + Facebook Pages) ──────────────
  ((): OAuthProvider => ({
    kind: "whatsapp",
    label: "WhatsApp Cloud API",
    brandColor: "#25D366",
    scopes: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
    usesPkce: false,
    clientId: () => env("META_APP_ID"),
    clientSecret: () => env("META_APP_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://www.facebook.com/v21.0/dialog/oauth?${qs({
        client_id: env("META_APP_ID") ?? "",
        redirect_uri: redirectUri,
        state,
        scope: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"].join(",")
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const url = `https://graph.facebook.com/v21.0/oauth/access_token?${qs({
        client_id: env("META_APP_ID") ?? "",
        client_secret: env("META_APP_SECRET") ?? "",
        redirect_uri: redirectUri,
        code
      })}`;
      const res = await fetch(url);
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`Meta exchange failed: ${(j.error as { message?: string })?.message ?? res.statusText}`);
      return {
        access_token: String(j.access_token ?? ""),
        token_type: typeof j.token_type === "string" ? j.token_type : "bearer",
        expires_in: typeof j.expires_in === "number" ? j.expires_in : undefined,
        raw: j
      };
    }
  }))(),

  ((): OAuthProvider => ({
    kind: "instagram",
    label: "Instagram",
    brandColor: "#E1306C",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_manage_posts"],
    usesPkce: false,
    clientId: () => env("META_APP_ID"),
    clientSecret: () => env("META_APP_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://www.facebook.com/v21.0/dialog/oauth?${qs({
        client_id: env("META_APP_ID") ?? "",
        redirect_uri: redirectUri,
        state,
        scope: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_manage_posts"].join(",")
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const url = `https://graph.facebook.com/v21.0/oauth/access_token?${qs({
        client_id: env("META_APP_ID") ?? "",
        client_secret: env("META_APP_SECRET") ?? "",
        redirect_uri: redirectUri,
        code
      })}`;
      const res = await fetch(url);
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`Meta exchange failed: ${(j.error as { message?: string })?.message ?? res.statusText}`);
      return { access_token: String(j.access_token ?? ""), raw: j };
    }
  }))(),

  // ─── LinkedIn ──────────────────────────────────────────────────────────────
  {
    kind: "linkedin",
    label: "LinkedIn",
    brandColor: "#0A66C2",
    scopes: ["openid", "profile", "email", "w_member_social"],
    usesPkce: false,
    clientId: () => env("LINKEDIN_CLIENT_ID"),
    clientSecret: () => env("LINKEDIN_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://www.linkedin.com/oauth/v2/authorization?${qs({
        response_type: "code",
        client_id: env("LINKEDIN_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        state,
        scope: "openid profile email w_member_social"
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://www.linkedin.com/oauth/v2/accessToken", {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: env("LINKEDIN_CLIENT_ID") ?? "",
        client_secret: env("LINKEDIN_CLIENT_SECRET") ?? ""
      });
    }
  },

  // ─── Slack ─────────────────────────────────────────────────────────────────
  {
    kind: "slack",
    label: "Slack",
    brandColor: "#4A154B",
    scopes: ["chat:write", "channels:read", "groups:read", "users:read", "im:read"],
    usesPkce: false,
    clientId: () => env("SLACK_CLIENT_ID"),
    clientSecret: () => env("SLACK_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://slack.com/oauth/v2/authorize?${qs({
        client_id: env("SLACK_CLIENT_ID") ?? "",
        scope: ["chat:write", "channels:read", "groups:read", "users:read", "im:read"].join(","),
        redirect_uri: redirectUri,
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const tokens = await postForm("https://slack.com/api/oauth.v2.access", {
        code,
        client_id: env("SLACK_CLIENT_ID") ?? "",
        client_secret: env("SLACK_CLIENT_SECRET") ?? "",
        redirect_uri: redirectUri
      });
      const raw = tokens.raw ?? {};
      // Slack returns the bot token under access_token, but it's the team's token
      return { ...tokens, access_token: String(raw.access_token ?? tokens.access_token) };
    },
    async identify(tokens) {
      const team = (tokens.raw as { team?: { id?: string; name?: string } } | undefined)?.team;
      if (!team?.id) return null;
      return { externalId: team.id, label: team.name ?? team.id };
    }
  },

  // ─── HubSpot ───────────────────────────────────────────────────────────────
  {
    kind: "hubspot",
    label: "HubSpot",
    brandColor: "#FF7A59",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "crm.objects.deals.write", "oauth"],
    usesPkce: false,
    clientId: () => env("HUBSPOT_CLIENT_ID"),
    clientSecret: () => env("HUBSPOT_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://app.hubspot.com/oauth/authorize?${qs({
        client_id: env("HUBSPOT_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        scope: "crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write oauth",
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://api.hubapi.com/oauth/v1/token", {
        grant_type: "authorization_code",
        client_id: env("HUBSPOT_CLIENT_ID") ?? "",
        client_secret: env("HUBSPOT_CLIENT_SECRET") ?? "",
        redirect_uri: redirectUri,
        code
      });
    }
  },

  // ─── Notion ────────────────────────────────────────────────────────────────
  {
    kind: "notion",
    label: "Notion",
    brandColor: "#000000",
    scopes: [],
    usesPkce: false,
    clientId: () => env("NOTION_CLIENT_ID"),
    clientSecret: () => env("NOTION_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://api.notion.com/v1/oauth/authorize?${qs({
        owner: "user",
        response_type: "code",
        client_id: env("NOTION_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const id = env("NOTION_CLIENT_ID") ?? "";
      const secret = env("NOTION_CLIENT_SECRET") ?? "";
      const basic = Buffer.from(`${id}:${secret}`).toString("base64");
      const res = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(`Notion exchange failed: ${(j.error as string) ?? res.statusText}`);
      return {
        access_token: String(j.access_token ?? ""),
        token_type: typeof j.token_type === "string" ? j.token_type : "bearer",
        raw: j
      };
    }
  },

  // ─── X / Twitter (PKCE) ────────────────────────────────────────────────────
  {
    kind: "x",
    label: "X (Twitter)",
    brandColor: "#000000",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    usesPkce: true,
    clientId: () => env("X_CLIENT_ID"),
    clientSecret: () => env("X_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri, codeChallenge }) {
      return `https://twitter.com/i/oauth2/authorize?${qs({
        response_type: "code",
        client_id: env("X_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        scope: "tweet.read tweet.write users.read offline.access",
        state,
        code_challenge: codeChallenge ?? "",
        code_challenge_method: "S256"
      })}`;
    },
    async exchange({ code, redirectUri, codeVerifier }) {
      const id = env("X_CLIENT_ID") ?? "";
      const secret = env("X_CLIENT_SECRET") ?? "";
      const params: Record<string, string> = {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: id,
        code_verifier: codeVerifier ?? ""
      };
      const headers: Record<string, string> = {};
      if (secret) {
        headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
      }
      return postForm("https://api.twitter.com/2/oauth2/token", params, headers);
    }
  },

  // ─── TikTok ────────────────────────────────────────────────────────────────
  {
    kind: "tiktok",
    label: "TikTok",
    brandColor: "#000000",
    scopes: ["user.info.basic", "video.upload", "video.publish"],
    usesPkce: false,
    clientId: () => env("TIKTOK_CLIENT_KEY"),
    clientSecret: () => env("TIKTOK_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://www.tiktok.com/v2/auth/authorize/?${qs({
        client_key: env("TIKTOK_CLIENT_KEY") ?? "",
        response_type: "code",
        scope: "user.info.basic,video.upload,video.publish",
        redirect_uri: redirectUri,
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: env("TIKTOK_CLIENT_KEY") ?? "",
        client_secret: env("TIKTOK_CLIENT_SECRET") ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      });
    }
  },

  // ─── GitHub ────────────────────────────────────────────────────────────────
  {
    kind: "github",
    label: "GitHub",
    brandColor: "#181717",
    scopes: ["repo", "read:org", "workflow"],
    usesPkce: false,
    clientId: () => env("GITHUB_CLIENT_ID"),
    clientSecret: () => env("GITHUB_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://github.com/login/oauth/authorize?${qs({
        client_id: env("GITHUB_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        scope: "repo read:org workflow",
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://github.com/login/oauth/access_token", {
        client_id: env("GITHUB_CLIENT_ID") ?? "",
        client_secret: env("GITHUB_CLIENT_SECRET") ?? "",
        code,
        redirect_uri: redirectUri
      });
    }
  },

  // ─── Stripe Connect ────────────────────────────────────────────────────────
  {
    kind: "stripe",
    label: "Stripe",
    brandColor: "#635BFF",
    scopes: ["read_write"],
    usesPkce: false,
    clientId: () => env("STRIPE_CLIENT_ID"),
    clientSecret: () => env("STRIPE_SECRET_KEY"),
    authorizeUrl({ state, redirectUri }) {
      return `https://connect.stripe.com/oauth/authorize?${qs({
        response_type: "code",
        client_id: env("STRIPE_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        scope: "read_write",
        state
      })}`;
    },
    async exchange({ code }) {
      return postForm("https://connect.stripe.com/oauth/token", {
        client_secret: env("STRIPE_SECRET_KEY") ?? "",
        code,
        grant_type: "authorization_code"
      });
    },
    async identify(tokens) {
      const acct = (tokens.raw as { stripe_user_id?: string } | undefined)?.stripe_user_id;
      return acct ? { externalId: acct, label: acct } : null;
    }
  },

  // ─── QuickBooks Online ─────────────────────────────────────────────────────
  {
    kind: "quickbooks",
    label: "QuickBooks",
    brandColor: "#2CA01C",
    scopes: ["com.intuit.quickbooks.accounting"],
    usesPkce: false,
    clientId: () => env("QUICKBOOKS_CLIENT_ID"),
    clientSecret: () => env("QUICKBOOKS_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://appcenter.intuit.com/connect/oauth2?${qs({
        client_id: env("QUICKBOOKS_CLIENT_ID") ?? "",
        response_type: "code",
        scope: "com.intuit.quickbooks.accounting",
        redirect_uri: redirectUri,
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const id = env("QUICKBOOKS_CLIENT_ID") ?? "";
      const secret = env("QUICKBOOKS_CLIENT_SECRET") ?? "";
      return postForm(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        { grant_type: "authorization_code", code, redirect_uri: redirectUri },
        { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` }
      );
    }
  },

  // ─── Xero ──────────────────────────────────────────────────────────────────
  {
    kind: "xero",
    label: "Xero",
    brandColor: "#13B5EA",
    scopes: ["openid", "profile", "email", "accounting.transactions", "offline_access"],
    usesPkce: false,
    clientId: () => env("XERO_CLIENT_ID"),
    clientSecret: () => env("XERO_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://login.xero.com/identity/connect/authorize?${qs({
        response_type: "code",
        client_id: env("XERO_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        scope: "openid profile email accounting.transactions offline_access",
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const id = env("XERO_CLIENT_ID") ?? "";
      const secret = env("XERO_CLIENT_SECRET") ?? "";
      return postForm(
        "https://identity.xero.com/connect/token",
        { grant_type: "authorization_code", code, redirect_uri: redirectUri },
        { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` }
      );
    }
  },

  // ─── Mailchimp ─────────────────────────────────────────────────────────────
  {
    kind: "mailchimp",
    label: "Mailchimp",
    brandColor: "#FFE01B",
    scopes: [],
    usesPkce: false,
    clientId: () => env("MAILCHIMP_CLIENT_ID"),
    clientSecret: () => env("MAILCHIMP_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://login.mailchimp.com/oauth2/authorize?${qs({
        response_type: "code",
        client_id: env("MAILCHIMP_CLIENT_ID") ?? "",
        redirect_uri: redirectUri,
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://login.mailchimp.com/oauth2/token", {
        grant_type: "authorization_code",
        client_id: env("MAILCHIMP_CLIENT_ID") ?? "",
        client_secret: env("MAILCHIMP_CLIENT_SECRET") ?? "",
        redirect_uri: redirectUri,
        code
      });
    }
  },

  // ─── Intercom ──────────────────────────────────────────────────────────────
  {
    kind: "intercom",
    label: "Intercom",
    brandColor: "#1F8DED",
    scopes: [],
    usesPkce: false,
    clientId: () => env("INTERCOM_CLIENT_ID"),
    clientSecret: () => env("INTERCOM_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      return `https://app.intercom.com/oauth?${qs({
        client_id: env("INTERCOM_CLIENT_ID") ?? "",
        state,
        redirect_uri: redirectUri
      })}`;
    },
    async exchange({ code, redirectUri }) {
      return postForm("https://api.intercom.io/auth/eagle/token", {
        client_id: env("INTERCOM_CLIENT_ID") ?? "",
        client_secret: env("INTERCOM_CLIENT_SECRET") ?? "",
        code,
        redirect_uri: redirectUri
      });
    }
  },

  // ─── Zendesk ───────────────────────────────────────────────────────────────
  {
    kind: "zendesk",
    label: "Zendesk",
    brandColor: "#03363D",
    scopes: ["read", "write"],
    usesPkce: false,
    clientId: () => env("ZENDESK_CLIENT_ID"),
    clientSecret: () => env("ZENDESK_CLIENT_SECRET"),
    authorizeUrl({ state, redirectUri }) {
      const subdomain = env("ZENDESK_SUBDOMAIN") ?? "your-subdomain";
      return `https://${subdomain}.zendesk.com/oauth/authorizations/new?${qs({
        response_type: "code",
        redirect_uri: redirectUri,
        client_id: env("ZENDESK_CLIENT_ID") ?? "",
        scope: "read write",
        state
      })}`;
    },
    async exchange({ code, redirectUri }) {
      const subdomain = env("ZENDESK_SUBDOMAIN") ?? "your-subdomain";
      return postForm(`https://${subdomain}.zendesk.com/oauth/tokens`, {
        grant_type: "authorization_code",
        code,
        client_id: env("ZENDESK_CLIENT_ID") ?? "",
        client_secret: env("ZENDESK_CLIENT_SECRET") ?? "",
        redirect_uri: redirectUri,
        scope: "read write"
      });
    }
  }
];

export const OAUTH_PROVIDERS: ReadonlyMap<IntegrationKind, OAuthProvider> = new Map(
  PROVIDERS.map((p) => [p.kind, p] as const)
);

export function getOAuthProvider(kind: IntegrationKind): OAuthProvider | undefined {
  return OAUTH_PROVIDERS.get(kind);
}

export function listConfiguredOAuthProviders(): Array<{
  kind: IntegrationKind;
  label: string;
  brandColor: string;
  configured: boolean;
}> {
  return Array.from(OAUTH_PROVIDERS.values()).map((p) => ({
    kind: p.kind,
    label: p.label,
    brandColor: p.brandColor,
    configured: Boolean(p.clientId())
  }));
}
