/**
 * Same-origin check for state-changing endpoints that browsers call with fetch().
 *
 * Browsers send `Origin` on every POST (and `Sec-Fetch-Site` on modern engines). Requiring a
 * matching origin stops cross-site form posts / login CSRF without a token round-trip. The
 * allowed origins are the request's own origin and NEXT_PUBLIC_SITE_URL (the request origin
 * can differ behind a TLS-terminating proxy).
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

export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins(req).has(origin)) return false;
  const fetchSite = req.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}
