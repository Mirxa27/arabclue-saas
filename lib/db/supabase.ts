import { createServerClient, type CookieOptions, type SetAllCookies } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

/** User-scoped Supabase client (respects RLS via auth cookies). */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(items: { name: string; value: string; options?: Record<string, unknown> }[]) {
          items.forEach((c) => cookieStore.set(c.name, c.value, c.options));
        }
      }
    }
  );
}

export type RouteHandlerSupabase = {
  supabase: SupabaseClient;
  /** Copy every cookie Supabase asked to set (session, PKCE verifier, removals) onto `res`. */
  applyCookies<T extends NextResponse>(res: T): T;
};

/**
 * Supabase client for route handlers that create or change the auth session
 * (OTP request, PKCE code exchange, token-hash verification, setSession).
 *
 * It is the @supabase/ssr server client, so it uses the PKCE flow and keeps the code
 * verifier and the session in cookies. Cookies are read from the request and every write
 * is captured, so the handler can attach them to whichever response it ends up returning
 * (JSON or a redirect). Returns null when Supabase is not configured.
 */
export function createRouteHandlerSupabase(req: NextRequest): RouteHandlerSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  // Keyed by name: when Supabase rewrites a cookie in one request the last write wins.
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll: ((items) => {
        for (const item of items) pending.set(item.name, item);
      }) satisfies SetAllCookies
    }
  });

  return {
    supabase,
    applyCookies(res) {
      for (const { name, value, options } of pending.values()) res.cookies.set(name, value, options);
      return res;
    }
  };
}

/** Service-role client for webhooks, cron, and other server-only jobs (bypasses RLS). */
export function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key?.trim()) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (Supabase Dashboard → Project Settings → API → service_role, or sb_secret_…)"
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
