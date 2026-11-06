import { getServerSupabase } from "@/lib/db/supabase";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Merchant } from "@/lib/types/database";
import { HttpError } from "@/lib/api/errors";
import { MERCHANT_CLIENT_COLUMNS } from "@/lib/merchant/columns";

export class AuthError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export async function getCurrentUser() {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Server components / page layouts — redirects to login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** API route handlers — returns JSON 401 instead of redirect. */
export async function requireUserApi() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

/**
 * The session user's merchant row — the client columns only (authenticated cannot SELECT the
 * Salla tokens or ZATCA credentials; read those with the service role). A failed lookup throws:
 * it must not look like "this user has no merchant" (redirect to /welcome, 403).
 */
export async function getCurrentMerchant(): Promise<Merchant | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("merchants")
    .select(MERCHANT_CLIENT_COLUMNS)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`merchant lookup failed: ${error.message}`);
  return (data as Merchant | null) ?? null;
}

export async function requireMerchant() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/welcome");
  return merchant;
}

/** The signed-in user and their merchant (if any), with a single auth round-trip. */
export async function getSessionContext(): Promise<{ user: User | null; merchant: Merchant | null }> {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getUser();
  const user = data.user ?? null;
  if (!user) return { user: null, merchant: null };
  const { data: merchant, error } = await supabase
    .from("merchants")
    .select(MERCHANT_CLIENT_COLUMNS)
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`merchant lookup failed: ${error.message}`);
  return { user, merchant: (merchant as Merchant | null) ?? null };
}

/**
 * API route handlers — throws AuthError (401) without a session and
 * HttpError (403) when the user has not created a merchant profile yet.
 * Never redirects: fetch() callers get JSON, not the login page.
 */
export async function requireMerchantApi(): Promise<Merchant> {
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
  return merchant;
}
