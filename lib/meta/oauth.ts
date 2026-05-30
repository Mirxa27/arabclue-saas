import { z } from "zod";
import { oauthCallbackUri } from "@/lib/oauth/redirect-uri";

const TokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional()
});

const PagesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      access_token: z.string(),
      instagram_business_account: z.object({ id: z.string() }).optional()
    })
  )
});

const WabaSchema = z.object({
  data: z.array(z.object({ id: z.string() }))
});

export type MetaOAuthTarget = "instagram" | "whatsapp";

export function metaRedirectUri(): string {
  return process.env.META_REDIRECT_URI ?? oauthCallbackUri("/api/oauth/meta/callback");
}

export function buildMetaAuthorizeURL(opts: {
  appId: string;
  state: string;
  target: MetaOAuthTarget;
}): string {
  const scopes =
    opts.target === "whatsapp"
      ? ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"]
      : [
          "instagram_basic",
          "instagram_content_publish",
          "pages_show_list",
          "pages_read_engagement",
          "business_management"
        ];

  const params = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: metaRedirectUri(),
    state: opts.state,
    scope: scopes.join(","),
    response_type: "code"
  });
  return `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
}

export async function exchangeMetaCode(code: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: metaRedirectUri(),
    code
  });
  const res = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status}`);
  const short = TokenSchema.parse(await res.json());

  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token
  });
  const longRes = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?${longParams}`);
  if (!longRes.ok) throw new Error(`Meta long-lived token failed: ${longRes.status}`);
  const long = TokenSchema.parse(await longRes.json());
  return { accessToken: long.access_token, expiresIn: long.expires_in };
}

export async function resolveInstagramAccount(accessToken: string): Promise<{ igUserId: string; pageId: string }> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/me/accounts?fields=id,instagram_business_account&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) throw new Error(`Meta pages fetch failed: ${res.status}`);
  const pages = PagesSchema.parse(await res.json());
  const page = pages.data.find((p) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account) {
    throw new Error("No Instagram Business account linked to your Facebook Pages");
  }
  return { igUserId: page.instagram_business_account.id, pageId: page.id };
}

export async function resolveWhatsAppPhoneId(accessToken: string): Promise<string> {
  const bizRes = await fetch(
    `https://graph.facebook.com/v20.0/me/businesses?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!bizRes.ok) throw new Error(`Meta businesses fetch failed: ${bizRes.status}`);
  const biz = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await bizRes.json());
  const businessId = biz.data[0]?.id;
  if (!businessId) throw new Error("No Meta Business account found for WhatsApp");

  const wabaRes = await fetch(
    `https://graph.facebook.com/v20.0/${businessId}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!wabaRes.ok) throw new Error(`WhatsApp business accounts fetch failed: ${wabaRes.status}`);
  const waba = WabaSchema.parse(await wabaRes.json());
  const wabaId = waba.data[0]?.id;
  if (!wabaId) throw new Error("No WhatsApp Business account found");

  const phoneRes = await fetch(
    `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`
  );
  if (!phoneRes.ok) throw new Error(`WhatsApp phone numbers fetch failed: ${phoneRes.status}`);
  const phones = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await phoneRes.json());
  const phoneId = phones.data[0]?.id;
  if (!phoneId) throw new Error("No WhatsApp phone number ID found");
  return phoneId;
}

/** Verify Meta webhook subscription (Instagram / WhatsApp). */
export function verifyMetaWebhook(mode: string | null, token: string | null, challenge: string | null): string | null {
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    return challenge;
  }
  return null;
}
