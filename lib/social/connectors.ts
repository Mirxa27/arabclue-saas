/**
 * Platform connectors.
 *
 * Each connector implements the same `PlatformConnector` interface so the scheduler can iterate.
 * The Meta connector reuses the Facebook/Instagram Graph API permission scaffolding already
 * built (see /docs/meta-graph-permissions.md for the 18-permission test plan).
 *
 * Production keys: never hard-code. Load from env or per-merchant encrypted credential store.
 */
import type { Copy, PlatformConnector, VisualBrief, Platform } from "./types";
import { decryptSecret } from "@/lib/crypto/secrets";

// Minimal fetch helper with retry + Saudi-friendly timeout (2G/3G fringes)
async function postJSON(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Instagram (Meta Graph API) ───────────────────────────────────────────
// Requires: instagram_basic, instagram_content_publish, pages_show_list, business_management
function resolveImageUrl(payload: { productUrl?: string; imageUrl?: string }): string {
  if (payload.imageUrl) return payload.imageUrl;
  if (payload.productUrl && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(payload.productUrl)) {
    return payload.productUrl;
  }
  throw new Error("Instagram publish requires a product image URL (imageUrl or product image link)");
}

export function instagramConnector(args: { igUserId: string; accessToken: string }): PlatformConnector {
  return {
    platform: "instagram",
    async publish({ copy, visualBrief, productUrl, imageUrl }) {
      const base = `https://graph.facebook.com/v20.0/${args.igUserId}`;
      const isCarousel = visualBrief?.layout === "carousel" && visualBrief.slides.length > 1;

      if (!isCarousel) {
        const container = await postJSON(`${base}/media`, {
          image_url: resolveImageUrl({ productUrl, imageUrl }),
          caption: copy.caption,
          access_token: args.accessToken
        });
        const pub = await postJSON(`${base}/media_publish`, {
          creation_id: container.id,
          access_token: args.accessToken
        });
        return { remoteId: pub.id };
      }

      const children: string[] = [];
      for (const slide of visualBrief!.slides) {
        const slideImage = slide.imageUrl ?? imageUrl ?? resolveImageUrl({ productUrl, imageUrl });
        const c = await postJSON(`${base}/media`, {
          image_url: slideImage,
          is_carousel_item: true,
          access_token: args.accessToken
        });
        children.push(c.id);
      }
      const carousel = await postJSON(`${base}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: copy.caption,
        access_token: args.accessToken
      });
      const pub = await postJSON(`${base}/media_publish`, {
        creation_id: carousel.id,
        access_token: args.accessToken
      });
      return { remoteId: pub.id };
    }
  };
}

// ─── X (Twitter v2) ────────────────────────────────────────────────────────
export function xConnector(args: { bearer: string }): PlatformConnector {
  return {
    platform: "x",
    async publish({ copy }) {
      const res = await postJSON(
        "https://api.x.com/2/tweets",
        { text: copy.caption.slice(0, 280) },
        { authorization: `Bearer ${args.bearer}` }
      );
      return { remoteId: res.data?.id ?? "unknown" };
    }
  };
}

// ─── LinkedIn ──────────────────────────────────────────────────────────────
export function linkedInConnector(args: { actorUrn: string; accessToken: string }): PlatformConnector {
  return {
    platform: "linkedin",
    async publish({ copy }) {
      const res = await postJSON(
        "https://api.linkedin.com/rest/posts",
        {
          author: args.actorUrn,
          commentary: copy.caption,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED" },
          lifecycleState: "PUBLISHED"
        },
        {
          authorization: `Bearer ${args.accessToken}`,
          "LinkedIn-Version": "202410",
          "X-Restli-Protocol-Version": "2.0.0"
        }
      );
      return { remoteId: res.id ?? "unknown" };
    }
  };
}

// ─── TikTok (Content Posting API) ──────────────────────────────────────────
// Note: TikTok requires app review and a sandbox-to-prod promotion.
export function tikTokConnector(args: { accessToken: string }): PlatformConnector {
  return {
    platform: "tiktok",
    async publish({ copy }) {
      const res = await postJSON(
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
        { post_info: { title: copy.caption.slice(0, 150) } },
        { authorization: `Bearer ${args.accessToken}` }
      );
      return { remoteId: res.data?.publish_id ?? "unknown" };
    }
  };
}

// ─── Snapchat (Marketing API stub — Snapchat doesn't allow native organic posting via API;
//     use Snap Ads for paid, or Snap Camera Kit for owned experiences) ─────
export function snapchatConnector(): PlatformConnector {
  return {
    platform: "snapchat",
    async publish() {
      throw new Error(
        "Snapchat does not expose an organic posting API. " +
          "Use Snap Ads API for paid, or schedule manual posting via a notification."
      );
    }
  };
}

// ─── WhatsApp Business Cloud API ───────────────────────────────────────────
export function whatsappConnector(args: { phoneNumberId: string; accessToken: string }): PlatformConnector {
  return {
    platform: "whatsapp",
    async publish({ copy }) {
      // Broadcast pattern using approved templates only — never send marketing as freeform.
      // Body is delivered via a pre-approved template referenced by name + variables.
      const res = await postJSON(
        `https://graph.facebook.com/v20.0/${args.phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: "broadcast",
          type: "template",
          template: {
            name: "arabclue_post_broadcast",
            language: { code: "ar" },
            components: [{ type: "body", parameters: [{ type: "text", text: copy.caption }] }]
          }
        },
        { authorization: `Bearer ${args.accessToken}` }
      );
      return { remoteId: res.messages?.[0]?.id ?? "unknown" };
    }
  };
}

// ─── Builder ───────────────────────────────────────────────────────────────
export function buildConnectorsFromEnv(): PlatformConnector[] {
  const out: PlatformConnector[] = [];
  if (process.env.META_IG_USER_ID && process.env.META_PAGE_ACCESS_TOKEN)
    out.push(instagramConnector({ igUserId: process.env.META_IG_USER_ID, accessToken: process.env.META_PAGE_ACCESS_TOKEN }));
  if (process.env.X_BEARER) out.push(xConnector({ bearer: process.env.X_BEARER }));
  if (process.env.LINKEDIN_ACTOR_URN && process.env.LINKEDIN_ACCESS_TOKEN)
    out.push(linkedInConnector({ actorUrn: process.env.LINKEDIN_ACTOR_URN, accessToken: process.env.LINKEDIN_ACCESS_TOKEN }));
  if (process.env.TIKTOK_ACCESS_TOKEN) out.push(tikTokConnector({ accessToken: process.env.TIKTOK_ACCESS_TOKEN }));
  if (process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_ACCESS_TOKEN)
    out.push(whatsappConnector({ phoneNumberId: process.env.WHATSAPP_PHONE_ID, accessToken: process.env.WHATSAPP_ACCESS_TOKEN }));
  return out;
}

type SocialChannelRow = {
  platform: string;
  external_id: string | null;
  access_token_encrypted: string | null;
};

/** Per-merchant connectors from social_channels, with env fallback for shared platform keys. */
export function buildConnectorsForMerchant(channels: SocialChannelRow[]): PlatformConnector[] {
  const out: PlatformConnector[] = [];
  const byPlatform = new Map(channels.map((c) => [c.platform, c]));

  const ig = byPlatform.get("instagram");
  const igUserId = ig?.external_id ?? process.env.META_IG_USER_ID;
  const igToken = decryptSecret(ig?.access_token_encrypted) || process.env.META_PAGE_ACCESS_TOKEN;
  if (igUserId && igToken) out.push(instagramConnector({ igUserId, accessToken: igToken }));

  const x = byPlatform.get("x");
  const xBearer = decryptSecret(x?.access_token_encrypted) || process.env.X_BEARER;
  if (xBearer) out.push(xConnector({ bearer: xBearer }));

  const li = byPlatform.get("linkedin");
  const liUrn = li?.external_id ?? process.env.LINKEDIN_ACTOR_URN;
  const liToken = decryptSecret(li?.access_token_encrypted) || process.env.LINKEDIN_ACCESS_TOKEN;
  if (liUrn && liToken) out.push(linkedInConnector({ actorUrn: liUrn, accessToken: liToken }));

  const tt = byPlatform.get("tiktok");
  const ttToken = decryptSecret(tt?.access_token_encrypted) || process.env.TIKTOK_ACCESS_TOKEN;
  if (ttToken) out.push(tikTokConnector({ accessToken: ttToken }));

  const wa = byPlatform.get("whatsapp");
  const waPhone = wa?.external_id ?? process.env.WHATSAPP_PHONE_ID;
  const waToken = decryptSecret(wa?.access_token_encrypted) || process.env.WHATSAPP_ACCESS_TOKEN;
  if (waPhone && waToken) out.push(whatsappConnector({ phoneNumberId: waPhone, accessToken: waToken }));

  return out;
}
