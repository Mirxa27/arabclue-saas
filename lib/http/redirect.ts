import { NextResponse } from "next/server";

/**
 * Redirect to a same-origin path with a *relative* `Location` header.
 *
 * The browser resolves it against the URL it actually requested, so the redirect stays on
 * the host that holds the session cookies (www vs apex, a preview domain) and never leaks
 * an internal proxy origin such as `http://localhost:3000` behind Hostinger/Passenger.
 * Only pass paths produced by our own code or validated with `safeRedirectPath`.
 */
export function relativeRedirect(path: string, status: 302 | 303 | 307 = 303): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("relativeRedirect only accepts same-origin paths");
  }
  return new NextResponse(null, {
    status,
    headers: { location: path, "cache-control": "no-store" }
  });
}
