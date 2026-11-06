/**
 * GET /api/integrations/status — what the integrations page shows (UI-001). Never returns tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFeatureSettings } from "@/lib/admin/platform-settings";
import { sallaConnectEntry, type SallaConnectEntry } from "@/lib/salla/config";
import { findClaimableSallaInstall, type PendingSallaInstall } from "@/lib/salla/connect";

export const SOCIAL_STATUS_PLATFORMS = ["instagram", "whatsapp", "tiktok", "linkedin", "x", "snapchat"] as const;
export type SocialStatusPlatform = (typeof SOCIAL_STATUS_PLATFORMS)[number];

export type IntegrationStatus = {
  /** A Salla store is linked and its tokens are usable (or refreshable). */
  salla_connected: boolean;
  /** Where "Connect Salla" goes (start route or App Store link); null when Salla is not configured. */
  salla_install_url: string | null;
  salla_connect_mode: SallaConnectEntry["mode"];
  /** Salla rejected the stored refresh token: the merchant has to connect again. */
  salla_reconnect_required: boolean;
  salla_store: { id: string; name: string | null } | null;
  /** An unlinked App Store install whose owner email matches the signed-in user (claimable). */
  salla_pending_install: PendingSallaInstall | null;
  /** Connected social channels, by platform. */
  channel_status: Partial<Record<SocialStatusPlatform, boolean>>;
  /** Platform app credentials for each OAuth provider (start + callback both need them). */
  oauth_configured: { meta: boolean; linkedin: boolean; x: boolean; tiktok: boolean };
  /** Platform admin switch for social connections. */
  social_oauth_enabled: boolean;
};

/** The merchant columns the status needs (the session's merchant row carries them). */
export type StatusMerchant = {
  id: string;
  salla_merchant_id: string | null;
  access_token: string | null;
  uninstalled_at?: string | null;
  salla_store_name?: string | null;
  salla_token_invalid_at?: string | null;
};

export type StatusUser = { email?: string | null; email_confirmed_at?: string | null };

function configured(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export function socialOAuthConfigured(): IntegrationStatus["oauth_configured"] {
  return {
    meta: configured("META_APP_ID", "META_APP_SECRET"),
    linkedin: configured("LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"),
    x: configured("X_CLIENT_ID", "X_CLIENT_SECRET"),
    tiktok: configured("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET")
  };
}

/** Linked store + live tokens + not uninstalled + not rejected by Salla. */
export function isSallaConnected(m: StatusMerchant): boolean {
  return Boolean(m.salla_merchant_id && m.access_token && !m.uninstalled_at && !m.salla_token_invalid_at);
}

export async function getIntegrationStatus(args: {
  merchant: StatusMerchant;
  user: StatusUser;
  /** The merchant's RLS-scoped session client (reads their own social_channels). */
  userClient: SupabaseClient;
  /** Service role (salla_installs has no Data API grants for users). */
  serviceClient: SupabaseClient;
}): Promise<IntegrationStatus> {
  const { merchant, user } = args;

  const { data: channels, error } = await args.userClient
    .from("social_channels")
    .select("platform")
    .eq("merchant_id", merchant.id);
  if (error) throw new Error(`social_channels lookup failed: ${error.message}`);
  const channelStatus: IntegrationStatus["channel_status"] = {};
  for (const row of (channels as Array<{ platform: string }> | null) ?? []) {
    if ((SOCIAL_STATUS_PLATFORMS as readonly string[]).includes(row.platform)) {
      channelStatus[row.platform as SocialStatusPlatform] = true;
    }
  }

  const connected = isSallaConnected(merchant);
  const reconnect = Boolean(merchant.salla_merchant_id && merchant.access_token && merchant.salla_token_invalid_at);
  // Only a confirmed email may claim an App Store install, and only while nothing is connected.
  const email = user.email_confirmed_at && user.email ? user.email : null;
  const pending = !connected && email ? await findClaimableSallaInstall(args.serviceClient, email) : null;

  const entry = sallaConnectEntry();
  const features = await getFeatureSettings();

  return {
    salla_connected: connected,
    salla_install_url: entry.url,
    salla_connect_mode: entry.mode,
    salla_reconnect_required: reconnect,
    salla_store: merchant.salla_merchant_id && (connected || reconnect)
      ? { id: merchant.salla_merchant_id, name: merchant.salla_store_name ?? null }
      : null,
    salla_pending_install: pending,
    channel_status: channelStatus,
    oauth_configured: socialOAuthConfigured(),
    social_oauth_enabled: features.socialOAuth !== false
  };
}
