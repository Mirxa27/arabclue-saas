/**
 * Post-sign-in redirect targets.
 *
 * Every `next` / `return_to` value arrives from a URL or a request body, so it is
 * attacker-controlled. It is only ever used as a same-origin *path*: absolute URLs,
 * protocol-relative URLs (`//evil`, `/\evil`, `\\evil`) and their percent-encoded
 * variants are rejected. Pure module — safe to import from client components.
 */

export const DEFAULT_AFTER_LOGIN = "/dashboard";
export const DEFAULT_AFTER_SIGNUP = "/welcome";

const MAX_NEXT_LENGTH = 2048;
const MAX_DECODE_ROUNDS = 3;
// Any origin works as long as it can never equal a real one; only same-origin results are kept.
const PLACEHOLDER_ORIGIN = "http://next.invalid";

// C0 controls, DEL and backslashes. Browsers strip tab/CR/LF inside URLs and treat "\" like "/",
// so "/\tevil.com" or "/\evil.com" would turn into "//evil.com".
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F\\]/;

/** Sign-in pages: redirecting there after sign-in would loop. */
export function isSignInPagePath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/login", "/signup"]);
}

/** Routes that create or change the session themselves (code exchange, OTP verify, logout). */
export function isAuthEndpointPath(pathname: string): boolean {
  return matchesPrefix(pathname, ["/auth", "/api/auth"]);
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isUnsafeForm(value: string): boolean {
  return !value.startsWith("/") || value.startsWith("//") || FORBIDDEN_CHARS.test(value);
}

/**
 * Returns `next` normalised to a same-origin path (`/path?query#hash`) when it is safe to
 * redirect to, otherwise null. Callers fall back to a fixed default.
 */
export function safeRedirectPath(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_NEXT_LENGTH) return null;

  // Check the raw value and each percent-decoded form, so "/%2F%2Fevil.com" or "/%5Cevil.com"
  // cannot become dangerous in a layer that decodes once more.
  let current = next;
  let stable = false;
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round++) {
    if (isUnsafeForm(current)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null; // malformed escapes are never a legitimate app path
    }
    if (decoded === current) {
      stable = true;
      break;
    }
    current = decoded;
  }
  if (!stable) return null; // nested encoding deeper than any real link uses

  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  if (isSignInPagePath(url.pathname) || isAuthEndpointPath(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login` with an optional stable error code and a validated `next`. */
export function loginPath(opts: { error?: string; next?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.error) params.set("error", opts.error);
  const next = safeRedirectPath(opts.next);
  if (next && next !== DEFAULT_AFTER_LOGIN) params.set("next", next);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
