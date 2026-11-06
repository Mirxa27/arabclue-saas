/**
 * Same-origin check for state-changing endpoints that browsers call with fetch().
 *
 * Browsers send `Origin` on every POST (and `Sec-Fetch-Site` on modern engines). Requiring a
 * matching origin stops cross-site form posts / login CSRF without a token round-trip.
 *
 * An Origin is accepted when it is
 *  - the request's own origin (local dev, Vercel), or NEXT_PUBLIC_SITE_URL's origin; or
 *  - on the host the request was addressed to: the first X-Forwarded-Host entry or the Host
 *    header. Self-hosted Next (`next start`, Passenger's custom server on Hostinger) builds
 *    req.url from its own host:port (http://localhost:3000), never the public host, so without
 *    this every sign-in failed until NEXT_PUBLIC_SITE_URL was set — which needs a signed-in
 *    admin. Only the host is compared (the proxy may omit X-Forwarded-Proto); this is the check
 *    Next's Server Actions use. A browser cannot set Host or X-Forwarded-Host on a cross-site
 *    request (a custom header forces a CORS preflight, forms cannot add headers).
 * `Sec-Fetch-Site`, when present, must be `same-origin`.
 */
export function allowedOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(req.url).origin);
  } catch {
    /* ignore */
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      origins.add(new URL(site).origin);
    } catch {
      /* misconfigured site URL — request origin still applies */
    }
  }
  return origins;
}

function firstForwardedHost(req: Request): string | null {
  return req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || null;
}

/** `value` (a Host-style "name[:port]") as URL.host under `protocol`, or null when it is not one. */
function normalizedHost(value: string | null, protocol: string): string | null {
  if (!value || value.length > 255 || /[/\\?#@\s]/.test(value)) return null;
  try {
    return new URL(`${protocol}//${value}`).host;
  } catch {
    return null;
  }
}

function originAddressedHost(req: Request, origin: URL): boolean {
  return [firstForwardedHost(req), req.headers.get("host")].some(
    (value) => normalizedHost(value, origin.protocol) === origin.host
  );
}

export function isSameOriginRequest(req: Request): boolean {
  const originHeader = req.headers.get("origin");
  if (!originHeader) return false;
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false; // "null" (sandboxed frames, opaque redirects) or garbage
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") return false;
  if (!allowedOrigins(req).has(origin.origin) && !originAddressedHost(req, origin)) return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

/** What the check saw, for the server log when a request is rejected (no cookies, no body). */
export function describeOriginCheck(req: Request): {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  allowedOrigins: string[];
} {
  return {
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    host: req.headers.get("host"),
    forwardedHost: firstForwardedHost(req),
    allowedOrigins: [...allowedOrigins(req)]
  };
}
