/**
 * Usable access tokens for a merchant's social channels (SW-27).
 *
 * X and TikTok access tokens live two hours and their refresh tokens are single-use: a refresh
 * returns a new refresh token and the old one stops working, so two workers refreshing the same
 * channel at once would lock the merchant out. The same protocol as Salla (lib/salla/tokens.ts):
 *
 *   1. A token that is not near expiry (and was not just rejected) is used as is.
 *   2. Otherwise one worker takes the channel's refresh lease (social_claim_token_refresh) and
 *      re-reads the row: if someone refreshed meanwhile, it uses that token.
 *   3. The lease holder calls the provider once and stores the rotated pair with a compare-and-swap
 *      on (lease, old refresh token), so a reconnect or disconnect meanwhile is never overwritten.
 *      Everyone else waits for the stored result.
 *   4. A rejected grant marks the channel token_invalid_at ("reconnect required"); a reconnect
 *      (new access token) clears it again (trigger social_channels_token_changed).
 *
 * Instagram (long-lived Meta tokens) and LinkedIn (60-day tokens; refresh tokens only for
 * approved partners) have no refresh path here: once expired they are "reconnect required".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { reportError } from "@/lib/observability/error-reporter";
import { refreshTikTokToken } from "@/lib/tiktok/oauth";
import { refreshXToken } from "@/lib/x/oauth";
import { TokenRefreshError, type RefreshedTokens } from "./http";
import type { Platform } from "./types";

export const SOCIAL_REFRESH_SKEW_MS = 5 * 60_000;
/** Must comfortably exceed the token endpoint timeout (15 s) so a live holder finishes first. */
export const SOCIAL_REFRESH_LEASE_SECONDS = 60;
export const SOCIAL_REFRESH_WAIT_MS = 15_000;

export type ChannelRow = {
  id: string;
  merchant_id: string;
  platform: string;
  external_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  token_invalid_at: string | null;
};

export const CHANNEL_COLUMNS =
  "id, merchant_id, platform, external_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, token_invalid_at";

export type ChannelTokenErrorCode = "not_connected" | "reconnect_required" | "refresh_failed" | "refresh_busy";

export class ChannelTokenError extends Error {
  readonly code: ChannelTokenErrorCode;
  constructor(code: ChannelTokenErrorCode, message: string) {
    super(message);
    this.name = "ChannelTokenError";
    this.code = code;
  }
}

type Refresher = (refreshToken: string) => Promise<RefreshedTokens>;

export const TOKEN_REFRESHERS: Partial<Record<Platform, Refresher>> = {
  x: refreshXToken,
  tiktok: refreshTikTokToken
};

export type ChannelTokenOptions = {
  /** An access token the provider just answered 401 to: refresh unless the stored one changed. */
  rejectedToken?: string;
  refreshers?: Partial<Record<Platform, Refresher>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitTimeoutMs?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const reconnect = (platform: string) =>
  new ChannelTokenError("reconnect_required", `The ${platform} connection expired or was revoked. Reconnect it on the Integrations page.`);

function expiresAtMs(row: ChannelRow): number | null {
  if (!row.token_expires_at) return null;
  const ms = Date.parse(row.token_expires_at);
  return Number.isFinite(ms) ? ms : null;
}

async function readChannel(sb: SupabaseClient, id: string): Promise<ChannelRow | null> {
  const { data, error } = await sb.from("social_channels").select(CHANNEL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`social_channels read failed: ${error.message}`);
  return (data as ChannelRow | null) ?? null;
}

/** The stored access token when it can be used now; null when it must be refreshed first. */
function usableToken(row: ChannelRow | null, opts: ChannelTokenOptions, now: number): string | null {
  if (!row?.access_token_encrypted) throw new ChannelTokenError("not_connected", "The account isn't connected");
  if (row.token_invalid_at) throw reconnect(row.platform);
  const access = decryptSecret(row.access_token_encrypted);
  if (!access) throw new ChannelTokenError("not_connected", "The account isn't connected");
  if (opts.rejectedToken && access === opts.rejectedToken) return null;
  const exp = expiresAtMs(row);
  if (exp !== null && exp - now <= SOCIAL_REFRESH_SKEW_MS) return null;
  return access;
}

/** Nothing to refresh with: keep using the current token while it is still valid. */
function withoutRefresh(row: ChannelRow, opts: ChannelTokenOptions, now: number): string {
  const access = row.access_token_encrypted ? decryptSecret(row.access_token_encrypted) : "";
  const exp = expiresAtMs(row);
  if (access && access !== opts.rejectedToken && (exp === null || exp > now)) return access;
  throw reconnect(row.platform);
}

async function claimLease(sb: SupabaseClient, channelId: string): Promise<string | null> {
  const { data, error } = await sb.rpc("social_claim_token_refresh", {
    p_channel_id: channelId,
    p_lease_seconds: SOCIAL_REFRESH_LEASE_SECONDS
  });
  if (error) throw new Error(`social token refresh lease failed: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

async function releaseLease(sb: SupabaseClient, channelId: string, lease: string): Promise<void> {
  const { error } = await sb
    .from("social_channels")
    .update({ refresh_lease: null, refresh_lease_until: null })
    .eq("id", channelId)
    .eq("refresh_lease", lease);
  // The lease expires on its own; a failed release only delays the next refresh.
  if (error) reportError(new Error(`social token lease release failed: ${error.message}`), { extra: { channelId } });
}

/** Mark the channel "reconnect required" unless its tokens changed meanwhile. */
export async function markChannelReconnectRequired(
  sb: SupabaseClient,
  row: Pick<ChannelRow, "id" | "merchant_id" | "access_token_encrypted" | "refresh_token_encrypted">,
  by: "refresh_token" | "access_token" = "refresh_token"
): Promise<void> {
  let query = sb.from("social_channels").update({ token_invalid_at: new Date().toISOString() }).eq("id", row.id);
  query =
    by === "refresh_token"
      ? query.eq("refresh_token_encrypted", row.refresh_token_encrypted ?? "")
      : query.eq("access_token_encrypted", row.access_token_encrypted ?? "");
  const { error } = await query;
  if (error) reportError(new Error(`social reconnect marker failed: ${error.message}`), { merchantId: row.merchant_id });
}

/** Store the rotated pair while still holding the lease. Retried: the new refresh token exists nowhere else. */
async function persistRefreshed(
  sb: SupabaseClient,
  row: ChannelRow,
  lease: string,
  tokens: RefreshedTokens,
  now: number,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> {
  const update = {
    access_token_encrypted: encryptSecret(tokens.accessToken),
    // Rotation: the old refresh token is spent either way; keep it only if none came back.
    refresh_token_encrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : row.refresh_token_encrypted,
    token_expires_at: tokens.expiresIn ? new Date(now + tokens.expiresIn * 1000).toISOString() : null,
    token_refreshed_at: new Date(now).toISOString(),
    refresh_lease: null,
    refresh_lease_until: null
  };
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await sb
      .from("social_channels")
      .update(update)
      .eq("id", row.id)
      .eq("refresh_lease", lease)
      .eq("refresh_token_encrypted", row.refresh_token_encrypted ?? "")
      .select("id");
    if (!error) return Array.isArray(data) && data.length > 0;
    lastError = error;
    await sleep(150 * 2 ** attempt);
  }
  reportError(new Error(`social refreshed tokens could not be stored: ${lastError?.message ?? "unknown"}`), {
    merchantId: row.merchant_id,
    extra: { severity: "critical", platform: row.platform, note: "the old refresh token is spent; the merchant may need to reconnect" }
  });
  throw new ChannelTokenError("refresh_failed", `Could not save the refreshed ${row.platform} connection`);
}

async function refreshHoldingLease(
  sb: SupabaseClient,
  channelId: string,
  lease: string,
  refresher: Refresher,
  opts: ChannelTokenOptions
): Promise<string> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  // Re-read under the lease: another worker may have refreshed just before we got it.
  const row = await readChannel(sb, channelId);
  const current = usableToken(row, opts, now());
  if (current) return current;
  if (!row!.refresh_token_encrypted) return withoutRefresh(row!, opts, now());

  let tokens: RefreshedTokens;
  try {
    tokens = await refresher(decryptSecret(row!.refresh_token_encrypted));
  } catch (err) {
    if (err instanceof TokenRefreshError && err.grantRejected) {
      await markChannelReconnectRequired(sb, row!);
      reportError(err, { merchantId: row!.merchant_id, extra: { step: "social token refresh", outcome: "reconnect_required" } });
      throw reconnect(row!.platform);
    }
    reportError(err, { merchantId: row!.merchant_id, extra: { step: "social token refresh", platform: row!.platform } });
    throw new ChannelTokenError("refresh_failed", `${row!.platform} did not refresh the connection. Try again shortly.`);
  }

  if (await persistRefreshed(sb, row!, lease, tokens, now(), sleep)) return tokens.accessToken;

  // The row changed while we refreshed (reconnected or disconnected): never overwrite it.
  const fresh = await readChannel(sb, channelId);
  return usableToken(fresh, { ...opts, rejectedToken: undefined }, now()) ?? tokens.accessToken;
}

/**
 * A valid access token for the channel: refreshed before `token_expires_at`, or after the
 * provider rejected `opts.rejectedToken` (401). Throws ChannelTokenError.
 */
export async function getChannelAccessToken(
  sb: SupabaseClient,
  channel: ChannelRow,
  opts: ChannelTokenOptions = {}
): Promise<string> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const refresher = (opts.refreshers ?? TOKEN_REFRESHERS)[channel.platform as Platform];

  const current = usableToken(channel, opts, now());
  if (current) return current;
  if (!refresher || !channel.refresh_token_encrypted) return withoutRefresh(channel, opts, now());

  const deadline = now() + (opts.waitTimeoutMs ?? SOCIAL_REFRESH_WAIT_MS);
  let delay = 150;
  for (;;) {
    const lease = await claimLease(sb, channel.id);
    if (lease) {
      try {
        return await refreshHoldingLease(sb, channel.id, lease, refresher, opts);
      } finally {
        await releaseLease(sb, channel.id, lease);
      }
    }

    // Another worker is refreshing (or nothing is refreshable): wait for the stored result.
    const latest = await readChannel(sb, channel.id);
    const token = usableToken(latest, opts, now());
    if (token) return token;
    if (!latest!.refresh_token_encrypted) return withoutRefresh(latest!, opts, now());
    if (now() >= deadline) {
      throw new ChannelTokenError("refresh_busy", `The ${channel.platform} connection is being refreshed. Try again in a moment.`);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 2_000);
  }
}
