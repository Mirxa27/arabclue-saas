import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/crypto/secrets";
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
