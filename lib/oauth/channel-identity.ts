/**
 * Provider account id for a manually pasted social access token (F34).
 *
 * social_channels.external_id routes inbound Meta webhooks and is the account the
 * publishers post as, so it must be the account the token actually belongs to —
 * derived here from the provider with the merchant's own token, never accepted from
 * the client. The same identity calls the OAuth callbacks use.
 */
import { HttpError } from "@/lib/api/errors";
import type { Platform } from "@/lib/social/types";
import { resolveInstagramAccount, resolveWhatsAppPhoneId } from "@/lib/meta/oauth";
import { resolveTikTokOpenId } from "@/lib/tiktok/oauth";
import { resolveXUserId } from "@/lib/x/oauth";
import { resolveLinkedInActorUrn } from "@/lib/linkedin/oauth";

export type VerifiablePlatform = Exclude<Platform, "snapchat">;
export type IdentityResolver = (accessToken: string) => Promise<string>;

export const CHANNEL_IDENTITY_RESOLVERS: Record<VerifiablePlatform, IdentityResolver> = {
  instagram: async (token) => (await resolveInstagramAccount(token)).igUserId,
  whatsapp: resolveWhatsAppPhoneId,
  tiktok: resolveTikTokOpenId,
  x: resolveXUserId,
  linkedin: resolveLinkedInActorUrn
};

export async function resolveChannelExternalId(
  platform: Platform,
  accessToken: string,
  resolvers: Record<VerifiablePlatform, IdentityResolver> = CHANNEL_IDENTITY_RESOLVERS
): Promise<string> {
  if (platform === "snapchat") {
    throw new HttpError(
      400,
      "Snapchat accounts cannot be verified from an access token, so they cannot be connected manually.",
      "platform_unverifiable"
    );
  }
  let externalId: string;
  try {
    externalId = (await resolvers[platform](accessToken))?.trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification failed";
    throw new HttpError(400, `Could not verify this access token with ${platform}: ${reason}`, "token_verification_failed");
  }
  if (!externalId) {
    throw new HttpError(400, `Could not verify this access token with ${platform}`, "token_verification_failed");
  }
  return externalId;
}
