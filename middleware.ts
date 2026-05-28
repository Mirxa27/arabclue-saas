import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(items: { name: string; value: string; options?: Record<string, unknown> }[]) {
          items.forEach((c) => res.cookies.set(c.name, c.value, c.options));
        }
      }
    }
  );

  const { data } = await supabase.auth.getUser();
  const url = new URL(req.url);
  const isProtected =
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/welcome") ||
    url.pathname.startsWith("/brand") ||
    url.pathname.startsWith("/social") ||
    url.pathname.startsWith("/voice") ||
    url.pathname.startsWith("/seo") ||
    url.pathname.startsWith("/invoices") ||
    url.pathname.startsWith("/settings") ||
    url.pathname.startsWith("/integrations") ||
    url.pathname.startsWith("/billing");
  const isAuthPage = url.pathname === "/login" || url.pathname === "/signup";

  if (isProtected && !data.user) {
    const redirectURL = new URL("/login", req.url);
    redirectURL.searchParams.set("next", url.pathname);
    return NextResponse.redirect(redirectURL);
  }
  if (isAuthPage && data.user) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
