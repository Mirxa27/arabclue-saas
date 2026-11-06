/**
 * Platform connectors: one `publish` per platform that resolves only once the provider confirmed
 * the post, and throws a PublishError (skipped / failed / unknown) otherwise.
 *
 * Provider references (read 2026-11-06):
 *  - Instagram (Instagram API with Facebook Login; Graph host + version from lib/meta/graph.ts):
 *    https://developers.facebook.com/docs/instagram-platform/content-publishing —
 *    POST /<IG_ID>/media (image_url, caption) → container, POST /<IG_ID>/media_publish
 *    (creation_id) → media id; "JPEG is the only image format supported"; carousels take
 *    is_carousel_item children (up to 20; we send at most 10).
 *  - X: POST https://api.x.com/2/tweets → 201 { data: { id, text } }; 280 weighted characters
 *    (lib/x/text.ts).
 *  - LinkedIn: POST https://api.linkedin.com/rest/posts with Linkedin-Version (lib/linkedin/api.ts)
 *    → "201 response and the response header x-restli-id contains the Post ID" (no body);
 *    commentary in little text format.
 *  - TikTok: photo posts (POST /v2/post/publish/content/init/, media_type PHOTO) only accept
 *    source PULL_FROM_URL from a URL prefix the developer verified with TikTok
 *    (403 url_ownership_unverified) and unaudited apps may only post privately; videos need a
 *    video asset. arabclue has neither (catalog images live on the merchant's Salla CDN), so the
 *    TikTok connector refuses honestly instead of sending a request TikTok rejects or reporting
 *    an inbox upload as "published".
 *  - WhatsApp Cloud API: `to` is "the recipient's phone number" (or a group id); there is no
 *    broadcast recipient, so a feed-style post cannot be "published" to WhatsApp.
 *
 * Tokens are never hard-coded and never come from platform env: connectors are built only from
 * the merchant's own social_channels (lib/social/publishers.ts).
 */
import { graphUrl } from "@/lib/meta/graph";
import {
  LINKEDIN_API_VERSION,
  LINKEDIN_COMMENTARY_MAX,
  LINKEDIN_REST_BASE,
  linkedInRestHeaders,
  toLittleText
} from "@/lib/linkedin/api";
import { X_MAX_WEIGHTED_LENGTH, xWeightedLength } from "@/lib/x/text";
import { ProviderHttpError, postJson } from "./http";
import { PublishError, classifyProviderError, skipped } from "./publish-error";
import type { PlatformConnector, PostMedia } from "./types";

export const X_TWEETS_URL = "https://api.x.com/2/tweets";
export const INSTAGRAM_CAROUSEL_MAX = 10;
export const INSTAGRAM_CAPTION_MAX = 2200;

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

function publishableImages(images: readonly PostMedia[]): string[] {
  return [...new Set(images.map((m) => m.url).filter(isHttpsUrl))];
}

/** The id field of a JSON object body, or undefined. */
function idOf(json: unknown, ...path: string[]): string | undefined {
  let node: unknown = json;
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" && node ? node : typeof node === "number" ? String(node) : undefined;
}

// ─── Instagram (Meta Graph API) ───────────────────────────────────────────
// Requires instagram_basic + instagram_content_publish (+ pages_show_list, business_management).

export function instagramConnector(args: { igUserId: string; accessToken: string }): PlatformConnector {
  const auth = { authorization: `Bearer ${args.accessToken}` };

  async function createContainer(body: Record<string, unknown>): Promise<string> {
    try {
      const res = await postJson("Instagram", graphUrl([args.igUserId, "media"]), body, auth);
      const id = idOf(res.json, "id");
      if (!id) throw new PublishError("provider_error", "Instagram created no media container");
      return id;
    } catch (err) {
      throw classifyInstagram(err, false);
    }
  }

  return {
    platform: "instagram",
    async publish({ copy, visualBrief, images }) {
      const urls = publishableImages(images);
      if (urls.length === 0) {
        throw skipped("no_image", "Instagram needs an image from your catalog (JPEG); this post has none.");
      }
      const caption = copy.caption.trim();
      if ([...caption].length > INSTAGRAM_CAPTION_MAX) {
        throw skipped("caption_too_long", `Instagram captions are limited to ${INSTAGRAM_CAPTION_MAX} characters.`);
      }

      const carousel = visualBrief?.layout === "carousel" && urls.length > 1;
      let creationId: string;
      if (!carousel) {
        creationId = await createContainer({ image_url: urls[0], caption });
      } else {
        const children: string[] = [];
        for (const url of urls.slice(0, INSTAGRAM_CAROUSEL_MAX)) {
          children.push(await createContainer({ image_url: url, is_carousel_item: true }));
        }
        creationId = await createContainer({ media_type: "CAROUSEL", children: children.join(","), caption });
      }

      try {
        const res = await postJson("Instagram", graphUrl([args.igUserId, "media_publish"]), { creation_id: creationId }, auth);
        const id = idOf(res.json, "id");
        if (!id) {
          throw new PublishError("outcome_unknown", "Instagram accepted media_publish without returning a media id", {
            outcome: "unknown"
          });
        }
        return { remoteId: id };
      } catch (err) {
        throw classifyInstagram(err, true);
      }
    }
  };
}

/** Graph errors: code 190 = invalid/expired token (reconnect), 4/17/32/613 = rate limits. */
function classifyInstagram(err: unknown, final: boolean): PublishError {
  if (err instanceof ProviderHttpError) {
    const graph = (err.json as { error?: { code?: number; message?: string } } | null)?.error;
    const message = `Instagram API ${err.status}: ${graph?.message ?? err.body}`.slice(0, 300);
    if (graph?.code === 190) {
      return new PublishError("reconnect_required", message, { status: err.status, unauthorized: true, cause: err });
    }
    if (graph?.code !== undefined && [4, 17, 32, 613].includes(graph.code)) {
      return new PublishError("rate_limited", message, { status: err.status, cause: err });
    }
    if (err.status < 500) return new PublishError("rejected", message, { status: err.status, cause: err });
  }
  return classifyProviderError(err, { final });
}

// ─── X (API v2) ────────────────────────────────────────────────────────────

export function xConnector(args: { bearer: string }): PlatformConnector {
  return {
    platform: "x",
    async publish({ copy }) {
      const text = copy.caption.trim();
      const weighted = xWeightedLength(text);
      if (!text) throw skipped("no_copy", "The X caption is empty.");
      // Captions are checked where they are written (generation + edit); never cut silently here.
      if (weighted > X_MAX_WEIGHTED_LENGTH) {
        throw skipped("caption_too_long", `The X caption is ${weighted}/${X_MAX_WEIGHTED_LENGTH} characters. Shorten it and re-queue.`);
      }
      try {
        const res = await postJson("X", X_TWEETS_URL, { text }, { authorization: `Bearer ${args.bearer}` });
        const id = idOf(res.json, "data", "id");
        if (!id) throw new PublishError("outcome_unknown", "X accepted the post without returning its id", { outcome: "unknown" });
        return { remoteId: id };
      } catch (err) {
        if (err instanceof ProviderHttpError && err.status === 403 && /duplicate/i.test(err.body)) {
          throw new PublishError("duplicate", err.message, { status: 403, cause: err });
        }
        throw classifyProviderError(err, { final: true });
      }
    }
  };
}

// ─── LinkedIn (versioned Posts API) ────────────────────────────────────────

export function linkedInConnector(args: { actorUrn: string; accessToken: string }): PlatformConnector {
  return {
    platform: "linkedin",
    async publish({ copy }) {
      const text = copy.caption.trim();
      if (!text) throw skipped("no_copy", "The LinkedIn caption is empty.");
      const commentary = toLittleText(text);
      if (commentary.length > LINKEDIN_COMMENTARY_MAX) {
        throw skipped("caption_too_long", `LinkedIn posts are limited to ${LINKEDIN_COMMENTARY_MAX} characters.`);
      }
      try {
        const res = await postJson(
          "LinkedIn",
          `${LINKEDIN_REST_BASE}/posts`,
          {
            author: args.actorUrn,
            commentary,
            visibility: "PUBLIC",
            distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false
          },
          linkedInRestHeaders(args.accessToken)
        );
        // 201 with an empty body; the post URN is in x-restli-id.
        const id = res.headers.get("x-restli-id") ?? idOf(res.json, "id");
        if (!id) {
          throw new PublishError("outcome_unknown", `LinkedIn answered ${res.status} without a post id`, { outcome: "unknown" });
        }
        return { remoteId: id };
      } catch (err) {
        if (err instanceof ProviderHttpError && err.status === 426) {
          throw new PublishError("rejected", `LinkedIn rejected API version ${LINKEDIN_API_VERSION} as no longer supported`, {
            status: 426,
            cause: err
          });
        }
        if (err instanceof ProviderHttpError && err.status === 422 && /duplicate/i.test(err.body)) {
          throw new PublishError("duplicate", err.message, { status: 422, cause: err });
        }
        throw classifyProviderError(err, { final: true });
      }
    }
  };
}

// ─── Platforms arabclue cannot publish to (honest refusals, nothing is sent) ─

export const UNSUPPORTED_PLATFORM_MESSAGES = {
  tiktok:
    "TikTok publishing isn't available: TikTok only pulls photos from verified domains and needs a video for video posts. Post this one from the TikTok app.",
  whatsapp:
    "WhatsApp has no broadcast feed: the Cloud API sends approved templates to one opted-in customer at a time.",
  snapchat: "Snapchat does not offer an API for organic posts."
} as const;

export type UnsupportedPlatform = keyof typeof UNSUPPORTED_PLATFORM_MESSAGES;

function unsupportedConnector(platform: UnsupportedPlatform): PlatformConnector {
  return {
    platform,
    async publish() {
      throw skipped("unsupported", UNSUPPORTED_PLATFORM_MESSAGES[platform]);
    }
  };
}

export const tikTokConnector = () => unsupportedConnector("tiktok");
export const whatsappConnector = () => unsupportedConnector("whatsapp");
export const snapchatConnector = () => unsupportedConnector("snapchat");
