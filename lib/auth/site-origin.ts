import type { NextRequest } from "next/server";

/**
 * Public origin used in sign-in links: NEXT_PUBLIC_SITE_URL, else the request's origin.
 * (Behind a self-hosted proxy the request origin is the internal one — set NEXT_PUBLIC_SITE_URL
 * in the bootstrap env, see docs/DEPLOYMENT.md §1.2.)
 */
export function siteOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall back to the request origin */
    }
  }
  return req.nextUrl.origin;
}
