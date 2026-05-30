import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { getPlatformEnv } from "@/lib/platform/env";

export function getPlatformAdminEmails(): string[] {
  const raw = getPlatformEnv("PLATFORM_ADMIN_EMAILS") ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function userIsPlatformAdmin(user: User | null | undefined): boolean {
  if (!user?.email) return false;
  const emails = getPlatformAdminEmails();
  if (emails.includes(user.email.toLowerCase())) return true;
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  return role === "platform_admin";
}

export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return userIsPlatformAdmin(user);
}

export async function requirePlatformAdmin(): Promise<User> {
  await requireUser();
  const user = await getCurrentUser();
  if (!userIsPlatformAdmin(user)) {
    redirect("/dashboard?admin=denied");
  }
  return user!;
}

export class PlatformAdminAuthError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PlatformAdminAuthError";
  }
}

/** For API routes — returns 401/403 instead of redirecting. */
export async function requirePlatformAdminApi(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new PlatformAdminAuthError("Unauthorized", 401);
  if (!userIsPlatformAdmin(user)) throw new PlatformAdminAuthError("Forbidden", 403);
  return user;
}
