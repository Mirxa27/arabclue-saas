/**
 * Binds an OAuth flow to the browser and merchant that started it (F16).
 *
 * The start route puts the signed state's nonce — and, for PKCE providers, the code verifier —
 * in a short-lived httpOnly SameSite=Lax cookie. The callback only proceeds when that cookie
 * matches `state.nonce` AND the signed-in merchant is `state.merchantId`. A victim who opens
 * an attacker's authorize link therefore can't attach their tokens to the attacker's account:
 * their browser has no matching cookie, and they are signed in as themselves.
 *
 * On https the cookie uses the `__Host-` prefix (Secure, Path=/, no Domain), so a sibling
 * subdomain cannot plant one.
 */
import { randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/security/compare";

export type OAuthFlow = "linkedin" | "meta" | "tiktok" | "x" | "salla" | "employee";

/** Lifetime of the flow cookie and of the signed state (seconds). */
export const OAUTH_FLOW_TTL_SEC = 600;

export type OAuthFlowBinding = { nonce: string; codeVerifier?: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function newOAuthNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function isHttpsRequest(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === "https:") return true;
  } catch {
    /* fall through to the proxy header */
  }
  return req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

export function oauthFlowCookieName(flow: OAuthFlow, secure: boolean): string {
  return `${secure ? "__Host-" : ""}ac_oauth_${flow}`;
}

export function encodeOAuthFlowBinding(binding: OAuthFlowBinding): string {
  return binding.codeVerifier ? `${binding.nonce}.${binding.codeVerifier}` : binding.nonce;
}

export function decodeOAuthFlowBinding(raw: string | null | undefined): OAuthFlowBinding | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length > 2) return null;
  const [nonce, codeVerifier] = parts;
  if (!TOKEN_RE.test(nonce)) return null;
  if (codeVerifier !== undefined && !TOKEN_RE.test(codeVerifier)) return null;
  return codeVerifier === undefined ? { nonce } : { nonce, codeVerifier };
}

function cookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

export function setOAuthFlowCookie(res: NextResponse, req: Request, flow: OAuthFlow, binding: OAuthFlowBinding): void {
  const secure = isHttpsRequest(req);
  res.cookies.set(
    oauthFlowCookieName(flow, secure),
    encodeOAuthFlowBinding(binding),
    cookieOptions(secure, OAUTH_FLOW_TTL_SEC)
  );
}

export function readOAuthFlowCookie(req: NextRequest, flow: OAuthFlow): OAuthFlowBinding | null {
  return decodeOAuthFlowBinding(req.cookies.get(oauthFlowCookieName(flow, isHttpsRequest(req)))?.value);
}

/** Expire the cookie with the same attributes it was set with (`__Host-` requires Secure). */
export function clearOAuthFlowCookie(res: NextResponse, req: Request, flow: OAuthFlow): void {
  const secure = isHttpsRequest(req);
  res.cookies.set(oauthFlowCookieName(flow, secure), "", cookieOptions(secure, 0));
}

export type OAuthBindingFailure = "state_mismatch" | "not_signed_in" | "merchant_mismatch";

/** null when the callback belongs to this browser and to the signed-in merchant. */
export function checkOAuthBinding(input: {
  binding: OAuthFlowBinding | null;
  stateNonce: string | null | undefined;
  stateMerchantId: string;
  /** Whether the callback request carries a valid session at all. */
  signedIn: boolean;
  /** The signed-in user's merchant id (null when the account has no merchant profile). */
  sessionMerchantId: string | null | undefined;
}): OAuthBindingFailure | null {
  if (!input.binding || !input.stateNonce || !safeEqual(input.binding.nonce, input.stateNonce)) {
    return "state_mismatch";
  }
  if (!input.signedIn) return "not_signed_in";
  if (!input.sessionMerchantId || input.sessionMerchantId !== input.stateMerchantId) return "merchant_mismatch";
  return null;
}
