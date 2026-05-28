import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function getServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
