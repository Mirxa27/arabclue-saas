/**
 * Demo merchant seed.
 *
 * Provisions a self-contained demo account (auth user + merchant + brand kit) so
 * a Salla reviewer can log in and see a configured dashboard. Idempotent — safe to
 * run repeatedly. Requires a service-role Supabase client (bypasses RLS).
 *
 * Run with `npm run db:seed` (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 *
 * The account is a real, entitled Pro merchant, so its password is never a value
 * from this repository: DEMO_MERCHANT_PASSWORD (≥ 12 characters) when set, otherwise
 * a random password generated for a NEW user and returned once for the operator to
 * hand to the reviewer. An existing user's password is changed only when
 * DEMO_MERCHANT_PASSWORD is set. The subscription runs for DEMO_MERCHANT_DAYS
 * (default 30) from each seed run, after which normal billing enforcement applies.
 *
 * This module imports only the SupabaseClient *type* (erased at build) so the
 * runner can execute it without the app's `@/` path alias.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEMO_EMAIL = (process.env.DEMO_MERCHANT_EMAIL ?? "demo@arabclue.com").trim().toLowerCase();
export const DEMO_PASSWORD_MIN_LENGTH = 12;
const DEFAULT_DEMO_DAYS = 30;
/** GoTrue's admin list endpoint pages users; 1000 is its maximum page size. */
const USERS_PER_PAGE = 1000;
const MAX_USER_PAGES = 100;

export type DemoSeedOptions = {
  email?: string;
  /** Explicit password; when absent a new user gets a generated one and an existing user keeps theirs. */
  password?: string;
  /** Subscription length from now, in days. */
  days?: number;
  now?: Date;
};

export type DemoSeedResult = {
  userId: string;
  merchantId: string;
  created: boolean;
  /** Set only when the seed generated the password (new user, no DEMO_MERCHANT_PASSWORD). Show it once. */
  generatedPassword?: string;
  /** Whether an existing user's password was replaced with the explicit one. */
  passwordUpdated: boolean;
  subscriptionExpiresAt: string;
};

/** Options from the environment (DEMO_MERCHANT_EMAIL / DEMO_MERCHANT_PASSWORD / DEMO_MERCHANT_DAYS). */
export function demoSeedOptionsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): DemoSeedOptions {
  const days = env.DEMO_MERCHANT_DAYS?.trim() ? Number(env.DEMO_MERCHANT_DAYS) : undefined;
  return {
    email: env.DEMO_MERCHANT_EMAIL?.trim() || undefined,
    password: env.DEMO_MERCHANT_PASSWORD || undefined,
    days
  };
}

/** Demo merchant row. owner_user_id ties it to the demo login (getCurrentMerchant and RLS key on it). */
export function buildDemoMerchant(id: string, opts: { now?: Date; days?: number } = {}) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? DEFAULT_DEMO_DAYS;
  return {
    id,
    owner_user_id: id,
    salla_merchant_id: "demo-arabclue",
    store_url: "https://demo.arabclue.com",
    seller_name: "متجر arabclue التجريبي",
    vat_number: "300000000000003",
    cr_number: "1010000000",
    plan: "pro" as const,
    subscription_status: "active" as const,
    subscription_expires_at: new Date(now.getTime() + days * 86_400_000).toISOString(),
    installed_at: now.toISOString()
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

/** 24 random bytes → 32 URL-safe characters. */
export function generateDemoPassword(): string {
  return randomBytes(24).toString("base64url");
}

function validatedOptions(opts: DemoSeedOptions) {
  const email = (opts.email ?? DEMO_EMAIL).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("DEMO_MERCHANT_EMAIL is not a valid email address");
  if (opts.password !== undefined && opts.password.length < DEMO_PASSWORD_MIN_LENGTH) {
    throw new Error(`DEMO_MERCHANT_PASSWORD must be at least ${DEMO_PASSWORD_MIN_LENGTH} characters`);
  }
  const days = opts.days ?? DEFAULT_DEMO_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("DEMO_MERCHANT_DAYS must be a whole number from 1 to 365");
  return { email, password: opts.password, days, now: opts.now ?? new Date() };
}

/** The auth user with this email, searching every page (listUsers returns one page at a time). */
async function findUserByEmail(client: SupabaseClient, email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === email);
    if (match) return { id: match.id };
    if (users.length < USERS_PER_PAGE) return null;
  }
  throw new Error(`Gave up looking for ${email} after ${MAX_USER_PAGES * USERS_PER_PAGE} users`);
}

export async function seedDemoMerchant(client: SupabaseClient, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  const opts = validatedOptions(options);

  let userId: string;
  let created = false;
  let generatedPassword: string | undefined;
  let passwordUpdated = false;

  const existing = await findUserByEmail(client, opts.email);
  if (existing) {
    userId = existing.id;
    if (opts.password !== undefined) {
      const { error } = await client.auth.admin.updateUserById(userId, { password: opts.password });
      if (error) throw new Error(`Failed to update the demo user's password: ${error.message}`);
      passwordUpdated = true;
    }
  } else {
    const password = opts.password ?? (generatedPassword = generateDemoPassword());
    const { data, error } = await client.auth.admin.createUser({ email: opts.email, password, email_confirm: true });
    if (error || !data?.user) throw new Error(`Failed to create demo user: ${error?.message ?? "unknown error"}`);
    userId = data.user.id;
    created = true;
  }

  const merchant = buildDemoMerchant(userId, { now: opts.now, days: opts.days });
  const { error: mErr } = await client.from("merchants").upsert(merchant, { onConflict: "id" });
  if (mErr) throw new Error(`Failed to upsert demo merchant: ${mErr.message}`);

  const { error: bErr } = await client.from("brand_kits").upsert(buildDemoBrandKit(userId), { onConflict: "merchant_id" });
  if (bErr) throw new Error(`Failed to upsert demo brand kit: ${bErr.message}`);

  return {
    userId,
    merchantId: userId,
    created,
    ...(generatedPassword ? { generatedPassword } : {}),
    passwordUpdated,
    subscriptionExpiresAt: merchant.subscription_expires_at
  };
}
