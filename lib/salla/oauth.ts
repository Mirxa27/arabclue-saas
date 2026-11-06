/**
 * Salla OAuth 2.0 + Merchant API transport.
 *
 * Two ways a store gets connected (docs.salla.dev/doc-421118):
 *   - Easy Mode (the only mode allowed for apps published on the Salla App Store): Salla sends the
 *     tokens to /api/salla/webhook as `app.store.authorize` (lib/salla/app-events.ts).
 *   - Custom Mode: /api/salla/oauth/start → accounts.salla.sa/oauth2/auth → /api/salla/oauth/callback.
 *
 * Access tokens live 14 days; refresh tokens are single-use and live 1 month. Never call
 * `refreshTokens` directly — go through getSallaAccessToken (lib/salla/tokens.ts), which holds the
 * per-merchant refresh lease so a refresh token is never used twice.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

export const SALLA_AUTH_BASE = "https://accounts.salla.sa";
export const SALLA_API_BASE = "https://api.salla.dev/admin/v2";

/** Documented access-token lifetime (14 days), used when Salla omits the expiry. */
export const SALLA_ACCESS_TOKEN_TTL_SEC = 14 * 24 * 60 * 60;

/** Per-request timeout for Salla calls (well under the 60 s refresh lease and Salla's 30 s webhook timeout). */
export const SALLA_HTTP_TIMEOUT_MS = 15_000;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096).nullish(),
  // The refresh grant documents `expires_in`; the code-exchange sample shows `expires`. Both are seconds.
  expires_in: z.number().positive().optional(),
  expires: z.number().positive().optional(),
  token_type: z.string().max(32).nullish(),
  scope: z.string().max(4096).nullish()
});

export type SallaTokens = {
  access_token: string;
  /** Present when the `offline_access` scope was granted. Single-use: every refresh rotates it. */
  refresh_token?: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  token_type?: string;
  scope?: string;
};

/**
 * Salla sends `expires` as a lifetime in seconds on the token endpoint and as a unix timestamp on
 * the app.store.authorize event. A value ≥ 1e9 can only be a timestamp (2001 or later).
 */
export function sallaExpiryToDate(expires: number | null | undefined, now = Date.now()): Date {
  if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0) {
    return new Date(now + SALLA_ACCESS_TOKEN_TTL_SEC * 1000);
  }
  if (expires >= 1e9) return new Date(expires * 1000);
  return new Date(now + expires * 1000);
}

export function parseSallaTokenResponse(raw: unknown, now = Date.now()): SallaTokens {
  const t = TokenResponseSchema.parse(raw);
  const expiresAt = t.expires_in !== undefined ? now + t.expires_in * 1000 : sallaExpiryToDate(t.expires, now).getTime();
  return {
    access_token: t.access_token,
    ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
    expires_in: Math.max(0, Math.round((expiresAt - now) / 1000)),
    ...(t.token_type ? { token_type: t.token_type } : {}),
    ...(t.scope ? { scope: t.scope } : {})
  };
}

/** Non-2xx answer from accounts.salla.sa/oauth2/token. `oauthError` is the RFC 6749 `error` code. */
export class SallaOAuthError extends Error {
  readonly status: number;
  readonly oauthError?: string;
  readonly grant: "authorization_code" | "refresh_token";

  constructor(status: number, oauthError: string | undefined, grant: "authorization_code" | "refresh_token") {
    super(
      `Salla ${grant === "refresh_token" ? "refresh" : "token exchange"} failed: ${status}${oauthError ? ` (${oauthError})` : ""}`
    );
    this.name = "SallaOAuthError";
    this.status = status;
    this.oauthError = oauthError;
    this.grant = grant;
  }

  /** The grant itself is dead (expired, revoked or already used) — only a new authorization helps. */
  get grantRejected(): boolean {
    return this.oauthError === "invalid_grant";
  }
}

/** Non-2xx answer from the Salla Merchant API or the user-info endpoint. The query string is dropped (PII). */
export class SallaApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(path: string, status: number) {
    const bare = path.split("?")[0];
    super(`Salla ${bare} → ${status}`);
    this.name = "SallaApiError";
    this.status = status;
    this.path = bare;
  }
}

export function buildAuthorizeURL(opts: { clientId: string; redirectUri: string; state: string; scope?: string }): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scope ?? "offline_access",
    state: opts.state
  });
  return `${SALLA_AUTH_BASE}/oauth2/auth?${params}`;
}

async function postTokenEndpoint(
  grant: "authorization_code" | "refresh_token",
  params: Record<string, string>
): Promise<SallaTokens> {
  const res = await fetch(`${SALLA_AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: grant, ...params }),
    signal: AbortSignal.timeout(SALLA_HTTP_TIMEOUT_MS)
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === "string" ? body.error.slice(0, 64) : undefined;
    throw new SallaOAuthError(res.status, code, grant);
  }
  return parseSallaTokenResponse(await res.json());
}

export function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<SallaTokens> {
  return postTokenEndpoint("authorization_code", {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    code: opts.code
  });
}

/** Single-use refresh (the old refresh token is invalid afterwards). Use getSallaAccessToken instead. */
export function refreshTokens(opts: { clientId: string; clientSecret: string; refreshToken: string }): Promise<SallaTokens> {
  return postTokenEndpoint("refresh_token", {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken
  });
}

/**
 * One Merchant API call with a given token. Throws SallaApiError on non-2xx. For merchant calls use
 * sallaApiForMerchant (lib/salla/tokens.ts): it refreshes before expiry and once after a 401.
 */
export async function sallaAPI<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SALLA_API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(SALLA_HTTP_TIMEOUT_MS),
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
      accept: "application/json"
    }
  });
  if (!res.ok) throw new SallaApiError(path, res.status);
  return res.json() as Promise<T>;
}

// ── store identity ─────────────────────────────────────────────────────────

const SallaIdSchema = z.union([z.number(), z.string().trim().min(1).max(64)]);

const StoreRefSchema = z.object({
  id: SallaIdSchema,
  name: z.string().max(500).nullish(),
  username: z.string().max(200).nullish(),
  domain: z.string().max(2048).nullish()
});

/** accounts.salla.sa/oauth2/user/info (docs.salla.dev/merchants/user-info.md). */
const UserInfoSchema = z.object({
  data: z.object({
    id: SallaIdSchema.optional(),
    name: z.string().max(500).nullish(),
    email: z.string().max(320).nullish(),
    role: z.string().max(32).nullish(),
    merchant: StoreRefSchema.optional(),
    // one documented example names the object `store`
    store: StoreRefSchema.optional()
  })
});

/** GET /store/info (docs.salla.dev/merchants/store-info.md). */
const StoreInfoSchema = z.object({ data: StoreRefSchema });

export type SallaStoreIdentity = {
  storeId: string;
  storeName: string | null;
  storeDomain: string | null;
  /** Lower-cased email of the Salla user who authorized the app — the owner or a store team member. */
  userEmail: string | null;
  /** `user` = store owner/admin, `team` = a store employee; null when Salla did not say. */
  userRole: "user" | "team" | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Who authorized the install, and for which store (needs only `offline_access`). */
export async function fetchSallaUserInfo(accessToken: string): Promise<SallaStoreIdentity> {
  const res = await fetch(`${SALLA_AUTH_BASE}/oauth2/user/info`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(SALLA_HTTP_TIMEOUT_MS)
  });
  if (!res.ok) throw new SallaApiError("/oauth2/user/info", res.status);
  const { data } = UserInfoSchema.parse(await res.json());
  const store = data.merchant ?? data.store;
  if (!store) throw new Error("Salla user/info response has no store");
  const email = clean(data.email)?.toLowerCase() ?? null;
  return {
    storeId: String(store.id),
    storeName: clean(store.name),
    storeDomain: clean(store.domain),
    userEmail: email && email.includes("@") ? email : null,
    userRole: data.role === "user" || data.role === "team" ? data.role : null
  };
}

/** Store id/name/domain from the Merchant API (fallback when user/info is unavailable). */
export async function fetchSallaStoreInfo(accessToken: string): Promise<SallaStoreIdentity> {
  const { data } = StoreInfoSchema.parse(await sallaAPI<unknown>("/store/info", accessToken));
  return {
    storeId: String(data.id),
    storeName: clean(data.name),
    storeDomain: clean(data.domain),
    userEmail: null,
    userRole: null
  };
}

// ── webhooks ───────────────────────────────────────────────────────────────

export function verifySallaWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SallaWebhookEventSchema = z.object({
  event: z.string(), // e.g., "order.created", "app.store.authorize"
  merchant: z.number().or(z.string()),
  created_at: z.string().optional(),
  data: z.unknown().optional()
});

export type SallaWebhookEvent = z.infer<typeof SallaWebhookEventSchema>;
