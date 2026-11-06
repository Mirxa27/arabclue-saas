import { createServerClient, type CookieOptions, type SetAllCookies } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/security/rate-limit";

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
  /**
   * Auth API only — deliberately no `.from()`: with SUPABASE_SECRET_KEY configured this client
   * carries a secret (service-level) key, so it must never be used for table queries.
   */
  auth: SupabaseClient["auth"];
  /** Copy every cookie Supabase asked to set (session, PKCE verifier, removals) onto `res`. */
  applyCookies<T extends NextResponse>(res: T): T;
};

/**
 * Optional server-only secret API key (`sb_secret_…`, SUPABASE_SECRET_KEY) for the sign-in
 * client. Supabase Auth only honours `sb-forwarded-for` on requests made with a secret key
 * (not the anon/publishable key, not a legacy service_role JWT), so anything else is ignored.
 */
export function authSecretKey(): string | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return key && key.startsWith("sb_secret_") ? key : null;
}

/**
 * Supabase client for route handlers that create or change the auth session
 * (OTP request, PKCE code exchange, token-hash verification).
 *
 * It is the @supabase/ssr server client, so it uses the PKCE flow and keeps the code
 * verifier and the session in cookies. Cookies are read from the request and every write
 * is captured, so the handler can attach them to whichever response it ends up returning
 * (JSON or a redirect). Returns null when Supabase is not configured.
 *
 * Every call it makes leaves from this server. With SUPABASE_SECRET_KEY set (and "IP address
 * forwarding" enabled under Authentication → Rate Limits) it sends the visitor's trusted IP
 * (`clientIp`, never the raw X-Forwarded-For) as `sb-forwarded-for`, so Supabase's per-IP
 * sign-in limits apply per visitor instead of to the server's one address. Without the key it
 * uses the anon key and forwards nothing, as before.
 */
export function createRouteHandlerSupabase(req: NextRequest): RouteHandlerSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;

  const secretKey = authSecretKey();
  const ip = secretKey ? clientIp(req) : "unknown";

  // Keyed by name: when Supabase rewrites a cookie in one request the last write wins.
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(url, secretKey ?? anonKey, {
    ...(secretKey && ip !== "unknown" ? { global: { headers: { "sb-forwarded-for": ip } } } : {}),
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
    auth: supabase.auth,
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
