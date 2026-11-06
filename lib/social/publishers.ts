/**
 * Per-merchant publishers for the scheduler: for every platform either a ready publisher (the
 * merchant's own connected account, with token refresh) or the reason nothing can be sent.
 *
 * Built ONLY from the merchant's own social_channels rows — there is deliberately no fallback
 * to platform-wide env tokens: the scheduler publishes every merchant's posts, so a fallback
 * would publish a merchant's content on the platform operator's own accounts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { UNSUPPORTED_PLATFORM_MESSAGES, instagramConnector, linkedInConnector, xConnector } from "./connectors";
import type { PublishCode } from "./outcomes";
import { PublishError, skipped } from "./publish-error";
import {
  ChannelTokenError,
  TOKEN_REFRESHERS,
  getChannelAccessToken,
  markChannelReconnectRequired,
  type ChannelRow,
  type ChannelTokenOptions
} from "./token-refresh";
import { SOCIAL_PLATFORMS, type Platform, type PlatformConnector, type PublishPayload, type PublishReceipt } from "./types";

export type PlatformPublisher =
  | { platform: Platform; available: true; publish(payload: PublishPayload): Promise<PublishReceipt> }
  | { platform: Platform; available: false; code: PublishCode; message: string };

export type MerchantPublishers = ReadonlyMap<Platform, PlatformPublisher>;

const CONNECTOR_FACTORIES: Partial<Record<Platform, (channel: ChannelRow, token: string) => PlatformConnector>> = {
  instagram: (c, token) => instagramConnector({ igUserId: c.external_id!, accessToken: token }),
  x: (_c, token) => xConnector({ bearer: token }),
  linkedin: (c, token) => linkedInConnector({ actorUrn: c.external_id!, accessToken: token })
};

/** Platforms whose provider identity (external_id) is part of the publish call. */
const NEEDS_EXTERNAL_ID: readonly Platform[] = ["instagram", "linkedin"];

const unsupportedMessage = (platform: Platform): string | undefined =>
  (UNSUPPORTED_PLATFORM_MESSAGES as Partial<Record<Platform, string>>)[platform];

function tokenFailure(err: unknown): PublishError {
  if (err instanceof ChannelTokenError) {
    if (err.code === "reconnect_required") return skipped("reconnect_required", err.message);
    if (err.code === "not_connected") return skipped("not_connected", err.message);
    return skipped("provider_error", err.message);
  }
  if (err instanceof PublishError) return err;
  return skipped("provider_error", err instanceof Error ? err.message : String(err));
}

export type PublisherOptions = {
  tokenOptions?: ChannelTokenOptions;
  factories?: Partial<Record<Platform, (channel: ChannelRow, token: string) => PlatformConnector>>;
};

export function buildMerchantPublishers(
  sb: SupabaseClient,
  channels: readonly ChannelRow[],
  opts: PublisherOptions = {}
): MerchantPublishers {
  const byPlatform = new Map(channels.map((c) => [c.platform, c]));
  const factories = { ...CONNECTOR_FACTORIES, ...(opts.factories ?? {}) };
  const refreshers = opts.tokenOptions?.refreshers ?? TOKEN_REFRESHERS;
  const out = new Map<Platform, PlatformPublisher>();

  for (const platform of SOCIAL_PLATFORMS) {
    const channel = byPlatform.get(platform);
    const unsupported = unsupportedMessage(platform);
    if (unsupported) {
      // Nothing is ever sent; the message explains why (see lib/social/connectors.ts).
      out.set(platform, { platform, available: false, code: "unsupported", message: unsupported });
      continue;
    }
    const factory = factories[platform];
    if (!channel?.access_token_encrypted || !factory) {
      out.set(platform, { platform, available: false, code: "not_connected", message: `${platform}: account not connected` });
      continue;
    }
    if (NEEDS_EXTERNAL_ID.includes(platform) && !channel.external_id) {
      out.set(platform, {
        platform,
        available: false,
        code: "reconnect_required",
        message: `${platform}: the connected account id is missing — reconnect it`
      });
      continue;
    }
    if (channel.token_invalid_at) {
      out.set(platform, {
        platform,
        available: false,
        code: "reconnect_required",
        message: `${platform}: the connection expired or was revoked — reconnect it`
      });
      continue;
    }

    const refreshable = Boolean(refreshers[platform] && channel.refresh_token_encrypted);
    out.set(platform, {
      platform,
      available: true,
      async publish(payload) {
        let token: string;
        try {
          token = await getChannelAccessToken(sb, channel, opts.tokenOptions);
        } catch (err) {
          throw tokenFailure(err);
        }
        try {
          return await factory(channel, token).publish(payload);
        } catch (err) {
          if (!(err instanceof PublishError) || !err.unauthorized) throw err;
          // 401: the post was not created. Refresh once and retry once where a refresh exists.
          if (refreshable) {
            let retryToken: string;
            try {
              retryToken = await getChannelAccessToken(sb, channel, { ...opts.tokenOptions, rejectedToken: token });
            } catch (refreshErr) {
              throw tokenFailure(refreshErr);
            }
            try {
              return await factory(channel, retryToken).publish(payload);
            } catch (retryErr) {
              if (!(retryErr instanceof PublishError) || !retryErr.unauthorized) throw retryErr;
            }
          }
          await markChannelReconnectRequired(sb, channel, "access_token");
          throw new PublishError("reconnect_required", `${platform} rejected the connection: ${err.message}`.slice(0, 300), {
            status: err.status,
            cause: err
          });
        }
      }
    });
  }
  return out;
}
