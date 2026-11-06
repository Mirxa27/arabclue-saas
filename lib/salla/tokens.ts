/**
 * The one way to get a usable Salla access token for a merchant.
 *
 * Salla access tokens expire after 14 days. Refresh tokens are SINGLE-USE: refreshing returns a
 * new refresh token and invalidates the old one, and presenting an old one again makes Salla
 * revoke every token of the install (the merchant then has to reinstall the app) —
 * docs.salla.dev/doc-421118, "Refresh Token Reuse". So:
 *
 *   1. A token that is not near expiry (and was not just rejected) is returned as is.
 *   2. Otherwise one worker per merchant takes the refresh lease (salla_claim_refresh_lease) and
 *      re-reads the row: if someone refreshed meanwhile, it uses that token instead.
 *   3. The lease holder calls Salla once and stores the new pair with a compare-and-swap on
 *      (lease, old refresh token), so a re-authorization, uninstall or disconnect that happened
 *      meanwhile is never overwritten. Everyone else waits for the stored result.
 *   4. `invalid_grant` marks the connection as needing a reconnect (salla_token_invalid_at).
 *
 * Tokens are stored encrypted (enc:v1:, lib/crypto/secrets.ts) and read with the service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { getServiceSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";
import { sallaAppCredentials } from "@/lib/salla/config";
import { refreshTokens, sallaAPI, SallaApiError, SallaOAuthError, type SallaTokens } from "@/lib/salla/oauth";

/** Refresh when less than this is left on the access token. */
export const SALLA_REFRESH_SKEW_MS = 10 * 60_000;
/**
 * Refresh lease length. Must comfortably exceed SALLA_HTTP_TIMEOUT_MS (lib/salla/oauth.ts) so a
 * live holder always finishes before its lease can expire (asserted in __tests__/salla/tokens.test.ts).
 */
export const SALLA_REFRESH_LEASE_SECONDS = 60;
/** How long a caller waits for another worker's refresh before giving up (503). */
export const SALLA_REFRESH_WAIT_MS = 20_000;

export type SallaTokenErrorCode =
  | "salla_not_connected"
  | "salla_reconnect_required"
  | "salla_not_configured"
  | "salla_refresh_busy"
  | "salla_refresh_failed";

/** Typed failure of the token layer; handleRouteError maps it to its status. */
export class SallaConnectionError extends HttpError {
  constructor(status: number, message: string, code: SallaTokenErrorCode) {
    super(status, message, code);
    this.name = "SallaConnectionError";
  }
}

const notConnected = () => new SallaConnectionError(409, "Salla store is not connected", "salla_not_connected");
const reconnectRequired = () =>
  new SallaConnectionError(409, "Salla access has expired. Reconnect your Salla store.", "salla_reconnect_required");

export type SallaTokenOptions = {
  /** Service-role client (default: getServiceSupabase()). */
  client?: SupabaseClient;
  /** An access token Salla just answered 401 to: refresh unless the stored token already changed. */
  rejectedToken?: string;
  /** Clock and sleep hooks (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitTimeoutMs?: number;
};

type TokenRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  salla_token_invalid_at: string | null;
};

const TOKEN_COLUMNS = "id, access_token, refresh_token, token_expires_at, salla_token_invalid_at";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readTokenRow(sb: SupabaseClient, merchantId: string): Promise<TokenRow | null> {
  const { data, error } = await sb.from("merchants").select(TOKEN_COLUMNS).eq("id", merchantId).maybeSingle();
  if (error) throw new Error(`Salla token read failed: ${error.message}`);
  return (data as TokenRow | null) ?? null;
}

function expiresAtMs(row: TokenRow): number | null {
  if (!row.token_expires_at) return null;
  const ms = Date.parse(row.token_expires_at);
  return Number.isFinite(ms) ? ms : null;
}

/** The stored access token when it can be used now; null when it must be refreshed first. */
function usableToken(row: TokenRow | null, opts: SallaTokenOptions, now: number): string | null {
  if (!row?.access_token) throw notConnected();
  if (row.salla_token_invalid_at) throw reconnectRequired();
  const access = decryptSecret(row.access_token);
  if (!access) throw notConnected();
  if (opts.rejectedToken && access === opts.rejectedToken) return null;
  const exp = expiresAtMs(row);
  if (exp !== null && exp - now <= SALLA_REFRESH_SKEW_MS) return null;
  return access;
}

/** No refresh token to use: keep using the current access token while it is still valid. */
function withoutRefresh(row: TokenRow, opts: SallaTokenOptions, now: number): string {
  const access = row.access_token ? decryptSecret(row.access_token) : "";
  const exp = expiresAtMs(row);
  if (access && access !== opts.rejectedToken && (exp === null || exp > now)) return access;
  throw reconnectRequired();
}

async function claimLease(sb: SupabaseClient, merchantId: string): Promise<string | null> {
  const { data, error } = await sb.rpc("salla_claim_refresh_lease", {
    p_merchant_id: merchantId,
    p_lease_seconds: SALLA_REFRESH_LEASE_SECONDS
  });
  if (error) throw new Error(`Salla refresh lease failed: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

async function releaseLease(sb: SupabaseClient, merchantId: string, lease: string): Promise<void> {
  const { error } = await sb
    .from("merchants")
    .update({ salla_refresh_lease: null, salla_refresh_lease_until: null })
    .eq("id", merchantId)
    .eq("salla_refresh_lease", lease);
  // The lease expires on its own; a failed release only delays the next refresh.
  if (error) reportError(new Error(`Salla refresh lease release failed: ${error.message}`), { merchantId });
}

async function markReconnectRequired(sb: SupabaseClient, merchantId: string, refreshTokenCipher: string): Promise<void> {
  const { error } = await sb
    .from("merchants")
    .update({ salla_token_invalid_at: new Date().toISOString() })
    .eq("id", merchantId)
    .eq("refresh_token", refreshTokenCipher);
  if (error) reportError(new Error(`Salla reconnect marker failed: ${error.message}`), { merchantId });
}

/**
 * Store the rotated pair only if this worker still holds the lease and nobody replaced the refresh
 * token meanwhile. Transient write errors are retried: the new refresh token exists nowhere else.
 */
async function persistRefreshed(
  sb: SupabaseClient,
  merchantId: string,
  lease: string,
  oldRefreshCipher: string,
  tokens: SallaTokens,
  now: number,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> {
  const update = {
    access_token: encryptSecret(tokens.access_token),
    // Rotation: the old refresh token is spent either way, so never keep it.
    refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
    salla_refresh_lease: null,
    salla_refresh_lease_until: null
  };
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await sb
      .from("merchants")
      .update(update)
      .eq("id", merchantId)
      .eq("salla_refresh_lease", lease)
      .eq("refresh_token", oldRefreshCipher)
      .select("id");
    if (!error) return Array.isArray(data) && data.length > 0;
    lastError = error;
    await sleep(150 * 2 ** attempt);
  }
  reportError(new Error(`Salla refreshed tokens could not be stored: ${lastError?.message ?? "unknown"}`), {
    merchantId,
    extra: { severity: "critical", note: "the old refresh token is spent; the merchant may need to reconnect" }
  });
  throw new SallaConnectionError(503, "Could not save the refreshed Salla connection. Try again.", "salla_refresh_failed");
}

async function refreshHoldingLease(
  sb: SupabaseClient,
  merchantId: string,
  lease: string,
  opts: SallaTokenOptions
): Promise<string> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  // Re-read under the lease: another worker may have refreshed just before we got it.
  const row = await readTokenRow(sb, merchantId);
  const current = usableToken(row, opts, now());
  if (current) return current;
  if (!row!.refresh_token) return withoutRefresh(row!, opts, now());

  const creds = sallaAppCredentials();
  if (!creds) throw new SallaConnectionError(503, "Salla app credentials are not configured", "salla_not_configured");

  let tokens: SallaTokens;
  try {
    tokens = await refreshTokens({ ...creds, refreshToken: decryptSecret(row!.refresh_token) });
  } catch (err) {
    if (err instanceof SallaOAuthError && err.grantRejected) {
      await markReconnectRequired(sb, merchantId, row!.refresh_token);
      reportError(err, { merchantId, extra: { step: "salla token refresh", outcome: "reconnect_required" } });
      throw reconnectRequired();
    }
    reportError(err, { merchantId, extra: { step: "salla token refresh" } });
    throw new SallaConnectionError(502, "Salla did not refresh the connection. Try again shortly.", "salla_refresh_failed");
  }

  if (await persistRefreshed(sb, merchantId, lease, row!.refresh_token, tokens, now(), sleep)) {
    return tokens.access_token;
  }

  // The row changed while we refreshed (re-authorized, uninstalled or disconnected): never
  // overwrite it. Use what is stored now; a disconnected store throws salla_not_connected.
  const fresh = await readTokenRow(sb, merchantId);
  return usableToken(fresh, { ...opts, rejectedToken: undefined }, now()) ?? tokens.access_token;
}

/**
 * A valid access token for the merchant's connected Salla store: refreshed before
 * `token_expires_at`, or after Salla rejected `opts.rejectedToken` (401).
 *
 * Throws SallaConnectionError: salla_not_connected (409), salla_reconnect_required (409),
 * salla_not_configured (503), salla_refresh_busy (503), salla_refresh_failed (502/503).
 */
export async function getSallaAccessToken(merchantId: string, opts: SallaTokenOptions = {}): Promise<string> {
  const sb = opts.client ?? getServiceSupabase();
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  const row = await readTokenRow(sb, merchantId);
  const current = usableToken(row, opts, now());
  if (current) return current;
  if (!row!.refresh_token) return withoutRefresh(row!, opts, now());

  const deadline = now() + (opts.waitTimeoutMs ?? SALLA_REFRESH_WAIT_MS);
  let delay = 150;
  for (;;) {
    const lease = await claimLease(sb, merchantId);
    if (lease) {
      try {
        return await refreshHoldingLease(sb, merchantId, lease, opts);
      } finally {
        await releaseLease(sb, merchantId, lease);
      }
    }

    // Another worker is refreshing (or there is nothing refreshable): wait for the stored result.
    const latest = await readTokenRow(sb, merchantId);
    const token = usableToken(latest, opts, now());
    if (token) return token;
    if (!latest!.refresh_token) return withoutRefresh(latest!, opts, now());
    if (now() >= deadline) {
      throw new SallaConnectionError(503, "Salla connection is being refreshed. Try again in a moment.", "salla_refresh_busy");
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 2_000);
  }
}

/**
 * Merchant API call on behalf of a merchant: uses getSallaAccessToken and, when Salla answers 401,
 * refreshes once and retries once. `init.body` must be re-sendable (a string), as it may be sent twice.
 */
export async function sallaApiForMerchant<T>(
  merchantId: string,
  path: string,
  init?: RequestInit,
  opts: SallaTokenOptions = {}
): Promise<T> {
  const token = await getSallaAccessToken(merchantId, opts);
  try {
    return await sallaAPI<T>(path, token, init);
  } catch (err) {
    if (!(err instanceof SallaApiError) || err.status !== 401) throw err;
  }
  const retryToken = await getSallaAccessToken(merchantId, { ...opts, rejectedToken: token });
  try {
    return await sallaAPI<T>(path, retryToken, init);
  } catch (err) {
    if (err instanceof SallaApiError && err.status === 401) {
      throw new SallaConnectionError(409, "Salla rejected the connection. Reconnect your Salla store.", "salla_reconnect_required");
    }
    throw err;
  }
}
