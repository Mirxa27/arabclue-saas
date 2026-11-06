import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { userIsPlatformAdminEdge } from "@/lib/auth/platform-admin-edge";
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

  // /auth/* (code exchange, OTP verification, implicit-token rescue) and /api/auth/* create,
  // replace or clear the session themselves and are always reachable without one. Refreshing
  // the session here as well would race their Set-Cookie headers.
  if (isAuthEndpointPath(pathname)) return NextResponse.next();

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
    const redirect = NextResponse.redirect(new URL(path, req.url));
    // Keep refreshed (or cleared) session cookies when we redirect instead of rendering.
    res.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  const merchantProtected = isMerchantProtectedPath(pathname);
  const adminProtected = isAdminProtectedPath(pathname);

  if ((merchantProtected || adminProtected) && !user) {
    return redirectTo(loginPath({ next: `${pathname}${search}` }));
  }

  if (adminProtected && user && !userIsPlatformAdminEdge(user)) {
    return redirectTo("/dashboard?admin=denied");
  }

  if (isSignInPagePath(pathname) && user) {
    return redirectTo(safeRedirectPath(req.nextUrl.searchParams.get("next")) ?? DEFAULT_AFTER_LOGIN);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
