import type { User } from "@supabase/supabase-js";

/** Edge-safe platform admin check (env + JWT metadata only — no DB hydrate). */
export function userIsPlatformAdminEdge(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  if (role === "platform_admin") return true;
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return emails.includes(user.email.toLowerCase());
}
