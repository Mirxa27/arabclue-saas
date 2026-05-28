/**
 * Salla OAuth + webhook glue.
 *
 * Flow:
 *   1. Merchant clicks "Install" in Salla App Store → Salla redirects to /api/salla/oauth/callback
 *   2. We exchange `code` for tokens, persist them per merchant
 *   3. We subscribe to webhooks (order.created, product.updated, app.installed, app.uninstalled)
 *   4. On order.created → generate ZATCA invoice, send to Fatoora, post status back to merchant dashboard
 *
 * Docs: https://docs.salla.dev/
 */
import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
  scope: z.string().optional()
});

export type SallaTokens = z.infer<typeof TokenResponseSchema>;

export const SALLA_AUTH_BASE = "https://accounts.salla.sa";
export const SALLA_API_BASE = "https://api.salla.dev/admin/v2";

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

export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<SallaTokens> {
  const res = await fetch(`${SALLA_AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code: opts.code
    })
  });
  if (!res.ok) throw new Error(`Salla token exchange failed: ${res.status}`);
  return TokenResponseSchema.parse(await res.json());
}

export async function refreshTokens(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<SallaTokens> {
  const res = await fetch(`${SALLA_AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken
    })
  });
  if (!res.ok) throw new Error(`Salla refresh failed: ${res.status}`);
  return TokenResponseSchema.parse(await res.json());
}

// Minimal API helper — auto-401-and-refresh is left to the caller's store layer
export async function sallaAPI<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SALLA_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
      accept: "application/json"
    }
  });
  if (!res.ok) throw new Error(`Salla ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Webhook signature verification ─────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

export function verifySallaWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SallaWebhookEventSchema = z.object({
  event: z.string(), // e.g., "order.created", "app.installed"
  merchant: z.number().or(z.string()),
  created_at: z.string().optional(),
  data: z.unknown()
});

export type SallaWebhookEvent = z.infer<typeof SallaWebhookEventSchema>;
