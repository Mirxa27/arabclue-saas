import { getServerSupabase } from "@/lib/db/supabase";
import { redirect } from "next/navigation";
import type { Merchant } from "@/lib/types/database";

export async function getCurrentUser() {
  const supabase = getServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function getCurrentMerchant(): Promise<Merchant | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("merchants")
    .select("*")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  return data as Merchant | null;
}

export async function requireMerchant() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/welcome");
  return merchant;
}
