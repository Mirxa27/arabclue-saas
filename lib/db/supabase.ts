import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** User-scoped Supabase client (respects RLS via auth cookies). */
export function getServerSupabase() {
  const cookieStore = cookies();
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
