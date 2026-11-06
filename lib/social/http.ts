/**
 * HTTP plumbing for the social providers (X, LinkedIn, Instagram Graph, token endpoints).
 *
 *  - a 2xx with an empty body is a success (LinkedIn answers a created post with
 *    `201` + `x-restli-id` and no body), and the response headers are kept;
 *  - a non-2xx becomes ProviderHttpError with the status and a redacted body snippet;
 *  - a transport failure (DNS, reset, timeout) becomes ProviderNetworkError: the request may
 *    or may not have reached the provider, which matters for "did the post go out?".
 */
import { redactSensitive } from "@/lib/observability/error-reporter";

export const PROVIDER_TIMEOUT_MS = 20_000;

export type ProviderResponse = {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null when the body is empty / not JSON. */
  json: unknown;
  text: string;
};

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly body: string;
  readonly json: unknown;

  constructor(provider: string, status: number, text: string, json: unknown) {
    const snippet = redactSensitive(text.slice(0, 300));
    super(`${provider} API ${status}${snippet ? `: ${snippet}` : ""}`);
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.body = snippet;
    this.json = json;
  }
}

export class ProviderNetworkError extends Error {
  readonly provider: string;
  constructor(provider: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${provider} request did not complete: ${redactSensitive(reason).slice(0, 200)}`, { cause });
    this.name = "ProviderNetworkError";
    this.provider = provider;
  }
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function providerRequest(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<ProviderResponse> {
  const { timeoutMs, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? PROVIDER_TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderNetworkError(provider, err);
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // Headers arrived (the provider handled the request) but the body was cut off.
    if (res.ok) return { status: res.status, headers: res.headers, json: null, text: "" };
    throw new ProviderNetworkError(provider, err);
  }
  const json = parseJson(text);
  if (!res.ok) throw new ProviderHttpError(provider, res.status, text, json);
  return { status: res.status, headers: res.headers, json, text };
}

/** POST a JSON body. */
export function postJson(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs?: number
): Promise<ProviderResponse> {
  return providerRequest(provider, url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    timeoutMs
  });
}

/** A provider refused or failed an OAuth refresh_token grant. */
export class TokenRefreshError extends Error {
  readonly provider: string;
  /** The provider rejected the refresh token itself: only a reconnect helps. */
  readonly grantRejected: boolean;
  readonly status?: number;

  constructor(provider: string, message: string, opts: { grantRejected?: boolean; status?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "TokenRefreshError";
    this.provider = provider;
    this.grantRejected = opts.grantRejected ?? false;
    this.status = opts.status;
  }
}

/** `{ error, error_description }` of an OAuth error body, if present. */
export function oauthErrorBody(json: unknown): { error?: string; description?: string } {
  if (!json || typeof json !== "object") return {};
  const body = json as Record<string, unknown>;
  return {
    error: typeof body.error === "string" ? body.error : undefined,
    description: typeof body.error_description === "string" ? body.error_description : undefined
  };
}

/** Tokens returned by a refresh_token grant. */
export type RefreshedTokens = {
  accessToken: string;
  /** Rotated refresh token (X and TikTok return a new one; the old one is spent). */
  refreshToken?: string;
  /** Seconds. */
  expiresIn?: number;
};

/** POST an application/x-www-form-urlencoded body (OAuth token endpoints, Graph API writes). */
export function postForm(
  provider: string,
  url: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
  timeoutMs?: number
): Promise<ProviderResponse> {
  return providerRequest(provider, url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
    timeoutMs
  });
}
