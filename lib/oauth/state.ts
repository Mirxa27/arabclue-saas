import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Platform } from "@/lib/social/types";

export type OAuthStatePayload = {
  merchantId: string;
  platform: Platform | "salla";
  exp: number;
  nonce: string;
  /** PKCE code challenge (X, TikTok) */
  codeChallenge?: string;
};

function stateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.CRON_SECRET;
  if (!secret) throw new Error("OAUTH_STATE_SECRET or CRON_SECRET is required for OAuth");
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", stateSecret()).update(payloadB64).digest("base64url");
}

export function createOAuthState(payload: Omit<OAuthStatePayload, "exp" | "nonce"> & { ttlSec?: number }): string {
  const full: OAuthStatePayload = {
    ...payload,
    nonce: randomBytes(12).toString("hex"),
    exp: Date.now() + (payload.ttlSec ?? 600) * 1000
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state");
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("OAuth state signature mismatch");

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
  if (payload.exp < Date.now()) throw new Error("OAuth state expired");
  if (!payload.merchantId || !payload.platform) throw new Error("OAuth state missing fields");
  return payload;
}
