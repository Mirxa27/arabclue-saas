import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { userIsPlatformAdminEdge } from "@/lib/auth/platform-admin-edge";
import {
  isAdminProtectedPath,
  isMerchantProtectedPath,
} from "@/lib/navigation/dashboard-nav";

function safeRedirectPath(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (next.startsWith("/login") || next.startsWith("/signup")) return null;
  return next;
}

export async function middleware(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse("Server configuration incomplete. Set Supabase env vars in hPanel.", {
      status: 503,
    });
  }

  const res = NextResponse.next({ request: req });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(items: { name: string; value: string; options?: Record<string, unknown> }[]) {
        items.forEach((c) => res.cookies.set(c.name, c.value, c.options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const url = new URL(req.url);
  const pathname = url.pathname;

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const merchantProtected = isMerchantProtectedPath(pathname);
  const adminProtected = isAdminProtectedPath(pathname);

  if ((merchantProtected || adminProtected) && !data.user) {
    const redirectURL = new URL("/login", req.url);
    redirectURL.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectURL);
  }

  if (adminProtected && data.user && !userIsPlatformAdminEdge(data.user)) {
    return NextResponse.redirect(new URL("/dashboard?admin=denied", req.url));
  }

  if (isAuthPage && data.user) {
    const next = safeRedirectPath(url.searchParams.get("next"));
    if (next) {
      return NextResponse.redirect(new URL(next, req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
