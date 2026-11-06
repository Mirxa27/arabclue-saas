/**
 * The OAuth result page contract (`/integrations/callback?platform=…&status=…&error=…`).
 * Callbacks build the URL with `oauthResultPath`; the page reads it with `parseOAuthResult`.
 * Pure module — safe to import from client components.
 */
import { isOAuthErrorCode, type OAuthErrorCode } from "@/lib/oauth/errors";

export const OAUTH_RESULT_PLATFORMS = ["salla", "instagram", "whatsapp", "tiktok", "linkedin", "x", "meta"] as const;

/** `meta` = an Instagram/WhatsApp flow whose target is unknown (state unreadable). */
export type OAuthResultPlatform = (typeof OAUTH_RESULT_PLATFORMS)[number];

export type OAuthOutcome = { ok: true } | { ok: false; error: OAuthErrorCode };

export function isOAuthResultPlatform(value: unknown): value is OAuthResultPlatform {
  return typeof value === "string" && (OAUTH_RESULT_PLATFORMS as readonly string[]).includes(value);
}

export function oauthResultPath(platform: OAuthResultPlatform, outcome: OAuthOutcome): string {
  const params = new URLSearchParams({ platform, status: outcome.ok ? "success" : "error" });
  if (!outcome.ok) params.set("error", outcome.error);
  return `/integrations/callback?${params.toString()}`;
}

export type ParsedOAuthResult = {
  /** null when the URL names no platform we know. */
  platform: OAuthResultPlatform | null;
  ok: boolean;
  /** Stable code; unrecognised values collapse to "unknown". Meaningless when ok. */
  error: OAuthErrorCode;
};

export function parseOAuthResult(params: { get(name: string): string | null }): ParsedOAuthResult {
  const platformParam = params.get("platform");
  const platform = isOAuthResultPlatform(platformParam) ? platformParam : null;
  const ok = params.get("status") === "success";
  const errorParam = params.get("error");
  return { platform, ok, error: isOAuthErrorCode(errorParam) ? errorParam : "unknown" };
}
