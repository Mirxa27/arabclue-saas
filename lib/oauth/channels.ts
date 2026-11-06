import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/crypto/secrets";
import { HttpError } from "@/lib/api/errors";
import { isUniqueViolation } from "@/lib/db/errors";
import type { Platform } from "@/lib/social/types";

export type ChannelTokens = {
  externalId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
};

export async function upsertSocialChannel(
  supabase: SupabaseClient,
  merchantId: string,
  platform: Platform,
  tokens: ChannelTokens
) {
  const { error } = await supabase.from("social_channels").upsert(
    {
      merchant_id: merchantId,
      platform,
      external_id: tokens.externalId,
      access_token_encrypted: encryptSecret(tokens.accessToken),
      refresh_token_encrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      token_expires_at: tokens.tokenExpiresAt ?? null,
      connected_at: new Date().toISOString()
    },
    { onConflict: "merchant_id,platform" }
  );
  // social_channels_platform_external_id_key: one store per provider account (inbound
  // webhooks are routed by external_id).
  if (isUniqueViolation(error)) {
    throw new HttpError(409, "This account is already connected to another arabclue store", "channel_already_connected");
  }
  if (error) throw new Error(error.message);
}

export async function disconnectSocialChannel(
  supabase: SupabaseClient,
  merchantId: string,
  platform: Platform
) {
  const { error } = await supabase
    .from("social_channels")
    .delete()
    .eq("merchant_id", merchantId)
    .eq("platform", platform);
  if (error) throw new Error(error.message);
}
