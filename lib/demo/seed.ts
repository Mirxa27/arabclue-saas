/**
 * Demo merchant seed.
 *
 * Provisions a self-contained demo account (auth user + merchant + brand kit) so
 * a Salla reviewer can log in and see a configured dashboard. Idempotent — safe to
 * run repeatedly. Requires a service-role Supabase client (bypasses RLS).
 *
 * Run with `npm run db:seed` (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 *
 * This module imports only the SupabaseClient *type* (erased at build) so the
 * runner can execute it without the app's `@/` path alias.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEMO_EMAIL = process.env.DEMO_MERCHANT_EMAIL ?? "demo@arabclue.com";
export const DEMO_PASSWORD = process.env.DEMO_MERCHANT_PASSWORD ?? "arabclue-demo-2026!";

export type DemoSeedResult = {
  userId: string;
  merchantId: string;
  created: boolean;
};

/** Demo merchant row — columns match supabase/migrations/0001_init.sql exactly. */
export function buildDemoMerchant(id: string) {
  return {
    id,
    salla_merchant_id: "demo-arabclue",
    store_url: "https://demo.arabclue.com",
    seller_name: "متجر arabclue التجريبي",
    vat_number: "300000000000003",
    cr_number: "1010000000",
    plan: "pro" as const,
    installed_at: new Date().toISOString()
  };
}

export function buildDemoBrandKit(merchantId: string) {
  return {
    merchant_id: merchantId,
    brand_name: "Bayt Al-Oud",
    essence: "Premium oud & bakhoor for Saudi households who value tradition.",
    attributes: ["أصالة", "تراث", "فخامة", "عود", "جودة"],
    favor_words: ["أصالة", "تراث", "فخامة"],
    avoid_words: ["رخيص", "تقليد", "سيء"],
    dialect: "khaliji" as const
  };
}

/** Find the demo auth user (createUser errors if the email exists) or create it. */
async function ensureDemoUser(
  client: SupabaseClient,
  email: string,
  password: string
): Promise<{ id: string; created: boolean }> {
  const { data: list } = await client.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`Failed to create demo user: ${error?.message ?? "unknown error"}`);
  return { id: data.user.id, created: true };
}

export async function seedDemoMerchant(client: SupabaseClient): Promise<DemoSeedResult> {
  const user = await ensureDemoUser(client, DEMO_EMAIL, DEMO_PASSWORD);

  const { error: mErr } = await client.from("merchants").upsert(buildDemoMerchant(user.id), { onConflict: "id" });
  if (mErr) throw new Error(`Failed to upsert demo merchant: ${mErr.message}`);

  const { error: bErr } = await client
    .from("brand_kits")
    .upsert(buildDemoBrandKit(user.id), { onConflict: "merchant_id" });
  if (bErr) throw new Error(`Failed to upsert demo brand kit: ${bErr.message}`);

  return { userId: user.id, merchantId: user.id, created: user.created };
}
