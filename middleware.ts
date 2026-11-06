import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_AFTER_LOGIN,
  isAuthEndpointPath,
  isSignInPagePath,
  loginPath,
  safeRedirectPath
} from "@/lib/auth/redirect";
import {
  isAdminProtectedPath,
  isMerchantProtectedPath,
} from "@/lib/navigation/dashboard-nav";

export async function middleware(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse("Server configuration incomplete. Set Supabase env vars in hPanel.", {
      status: 503,
    });
  }

  const { pathname, search } = req.nextUrl;

  // /auth/* (code exchange, OTP verification) and /api/auth/* create, replace or clear the
  // session themselves and are always reachable without one. Refreshing the session here as
  // well would race their Set-Cookie headers.
  // /auth/switch is a page, not an endpoint: it needs a refreshed session to show who is
  // signed in (it renders before any token-hash link is consumed).
  if (isAuthEndpointPath(pathname) && pathname !== "/auth/switch") return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll: ((items) => {
        // Refreshed tokens must reach both the page/route rendering this request (request
        // cookies) and the browser (response cookies) — otherwise the next server-side
        // getUser() refreshes again with an already-rotated refresh token.
        items.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        items.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      }) satisfies SetAllCookies,
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(sameOriginTarget(path, req.url));
    // Keep refreshed (or cleared) session cookies when we redirect instead of rendering.
    res.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  const merchantProtected = isMerchantProtectedPath(pathname);
  const adminProtected = isAdminProtectedPath(pathname);

  if ((merchantProtected || adminProtected) && !user) {
    return redirectTo(loginPath({ next: `${pathname}${search}` }));
  }

  // Admin authorization is NOT decided here: PLATFORM_ADMIN_EMAILS is admin-managed and
  // hydrated from the database into the Node runtime only, which edge middleware never
  // sees — an edge check bounced admins added via /admin/config. The authoritative gates
  // are requirePlatformAdmin() in app/(admin)/layout.tsx and requirePlatformAdminApi() on
  // every /api/admin/* route.

  if (isSignInPagePath(pathname) && user) {
    return redirectTo(safeRedirectPath(req.nextUrl.searchParams.get("next")) ?? DEFAULT_AFTER_LOGIN);
  }

  return res;
}

/**
 * `path` resolved against the request, or DEFAULT_AFTER_LOGIN on this origin when it would
 * leave it (or cannot be parsed). Defence in depth behind safeRedirectPath: a protocol-relative
 * value such as "//evil.example" must never become an off-site Location from a sign-in URL.
 * Compares with the request's own origin (not req.nextUrl, which rewrites 127.0.0.1 to localhost).
 */
function sameOriginTarget(path: string, requestUrl: string): URL {
  const base = new URL(requestUrl);
  try {
    const target = new URL(path, base);
    // Same origin AND not a "//host" path: Next relativizes same-origin Locations, and a
    // pathname starting with "//" would then be read by browsers as protocol-relative.
    if (target.origin === base.origin && !target.pathname.startsWith("//")) return target;
  } catch {
    /* unparsable target → default below */
  }
  return new URL(DEFAULT_AFTER_LOGIN, base);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
