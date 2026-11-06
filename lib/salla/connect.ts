/**
 * Linking Salla stores to arabclue merchants (service role; tokens encrypted before they leave
 * the app). The SQL functions in supabase/migrations/20261106003000_salla_connect.sql do the
 * atomic part under a per-store lock:
 *
 *   linkSallaStore              Custom Mode callback: the signed-in merchant just authorized the store
 *   recordSallaAuthorization    Easy Mode app.store.authorize: update the linked merchant, or park it
 *   claimSallaInstall           a parked authorization → the signed-in merchant, by confirmed owner email
 *   unlinkSallaStore            the merchant disconnects Salla in arabclue
 *   markSallaStoreUninstalled   Salla app.uninstalled (tokens revoked by Salla)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto/secrets";
import type { SallaStoreIdentity, SallaTokens } from "@/lib/salla/oauth";

/** Parked Easy Mode authorizations can be claimed for this long (the refresh token's lifetime). */
export const SALLA_INSTALL_CLAIM_DAYS = 30;

const OutcomeSchema = z.object({ outcome: z.string(), merchant_id: z.string().nullish() });

function outcomeOf(fn: string, data: unknown): z.infer<typeof OutcomeSchema> {
  const parsed = OutcomeSchema.safeParse(data);
  if (!parsed.success) throw new Error(`${fn} returned an unexpected value`);
  return parsed.data;
}

export type EncryptedSallaTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

/** enc:v1: ciphertext of a token pair plus its absolute expiry. */
export function encryptSallaTokens(tokens: SallaTokens, now = Date.now()): EncryptedSallaTokens {
  return {
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    expiresAt: new Date(now + tokens.expires_in * 1000).toISOString()
  };
}

export type SallaLinkOutcome = "linked" | "store_already_linked" | "merchant_not_found";

export async function linkSallaStore(
  sb: SupabaseClient,
  args: { merchantId: string; storeId: string; storeName: string | null; tokens: EncryptedSallaTokens }
): Promise<SallaLinkOutcome> {
  const { data, error } = await sb.rpc("salla_link_store", {
    p_merchant_id: args.merchantId,
    p_salla_merchant_id: args.storeId,
    p_access_token: args.tokens.accessToken,
    p_refresh_token: args.tokens.refreshToken,
    p_expires_at: args.tokens.expiresAt,
    p_store_name: args.storeName
  });
  // merchants.salla_merchant_id is unique; the function maps it, this is the race backstop
  if (error?.code === "23505") return "store_already_linked";
  if (error) throw new Error(`salla_link_store failed: ${error.message}`);
  const { outcome } = outcomeOf("salla_link_store", data);
  if (outcome === "linked" || outcome === "store_already_linked" || outcome === "merchant_not_found") return outcome;
  throw new Error(`salla_link_store returned outcome ${outcome}`);
}

export type SallaAuthorizationOutcome =
  | { outcome: "linked_updated"; merchantId: string }
  | { outcome: "pending_saved" }
  | { outcome: "stale" };

export async function recordSallaAuthorization(
  sb: SupabaseClient,
  args: { storeId: string; tokens: EncryptedSallaTokens; scope: string | null; identity: SallaStoreIdentity | null }
): Promise<SallaAuthorizationOutcome> {
  const { data, error } = await sb.rpc("salla_record_authorization", {
    p_salla_merchant_id: args.storeId,
    p_access_token: args.tokens.accessToken,
    p_refresh_token: args.tokens.refreshToken,
    p_expires_at: args.tokens.expiresAt,
    p_scope: args.scope,
    p_owner_email: args.identity?.userEmail ?? null,
    p_owner_role: args.identity?.userRole ?? null,
    p_store_name: args.identity?.storeName ?? null,
    p_store_domain: args.identity?.storeDomain ?? null
  });
  if (error) throw new Error(`salla_record_authorization failed: ${error.message}`);
  const result = outcomeOf("salla_record_authorization", data);
  if (result.outcome === "linked_updated" && result.merchant_id) return { outcome: "linked_updated", merchantId: result.merchant_id };
  if (result.outcome === "pending_saved") return { outcome: "pending_saved" };
  if (result.outcome === "stale") return { outcome: "stale" };
  throw new Error(`salla_record_authorization returned outcome ${result.outcome}`);
}

export type SallaClaimOutcome = SallaLinkOutcome | "not_found";

/**
 * Link a parked Easy Mode install to `merchantId`. `ownerEmail` MUST be the signed-in user's
 * confirmed email (never a value from the request body); the store id only picks among the
 * installs that email may claim.
 */
export async function claimSallaInstall(
  sb: SupabaseClient,
  args: { merchantId: string; storeId: string; ownerEmail: string }
): Promise<SallaClaimOutcome> {
  const { data, error } = await sb.rpc("salla_claim_install", {
    p_merchant_id: args.merchantId,
    p_salla_merchant_id: args.storeId,
    p_owner_email: args.ownerEmail
  });
  if (error) throw new Error(`salla_claim_install failed: ${error.message}`);
  const { outcome } = outcomeOf("salla_claim_install", data);
  if (outcome === "linked" || outcome === "store_already_linked" || outcome === "merchant_not_found" || outcome === "not_found") {
    return outcome;
  }
  throw new Error(`salla_claim_install returned outcome ${outcome}`);
}

export type PendingSallaInstall = {
  store_id: string;
  store_name: string | null;
  store_domain: string | null;
  authorized_at: string;
};

/** The newest Easy Mode install this (confirmed) email may claim as the store owner. */
export async function findClaimableSallaInstall(
  sb: SupabaseClient,
  ownerEmail: string,
  now = Date.now()
): Promise<PendingSallaInstall | null> {
  const email = ownerEmail.trim().toLowerCase();
  if (!email) return null;
  const since = new Date(now - SALLA_INSTALL_CLAIM_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("salla_installs")
    .select("salla_merchant_id, store_name, store_domain, authorized_at")
    .eq("owner_email", email)
    .eq("owner_role", "user")
    .gt("authorized_at", since)
    .order("authorized_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`salla_installs lookup failed: ${error.message}`);
  const row = (data as Array<{ salla_merchant_id: string; store_name: string | null; store_domain: string | null; authorized_at: string }> | null)?.[0];
  return row
    ? { store_id: row.salla_merchant_id, store_name: row.store_name, store_domain: row.store_domain, authorized_at: row.authorized_at }
    : null;
}

/** Columns that hold or guard a live Salla connection. */
const CLEARED_TOKEN_STATE = {
  access_token: null,
  refresh_token: null,
  token_expires_at: null,
  salla_refresh_lease: null,
  salla_refresh_lease_until: null,
  salla_token_invalid_at: null
} as const;

/**
 * Disconnect in arabclue: drop the tokens AND the store link, so the store's later webhooks
 * (orders, a re-authorization after an app update) no longer reach this merchant until the owner
 * connects or claims it again. Returns false when there was no merchant row.
 */
export async function unlinkSallaStore(sb: SupabaseClient, merchantId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await sb
    .from("merchants")
    .update({
      ...CLEARED_TOKEN_STATE,
      salla_merchant_id: null,
      salla_state: null,
      salla_store_name: null,
      uninstalled_at: now.toISOString()
    })
    .eq("id", merchantId)
    .select("id");
  if (error) throw new Error(`Salla disconnect failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Salla app.uninstalled: Salla revoked the tokens. The store link stays, so reinstalling the app
 * (app.store.authorize) reconnects the same merchant; a parked install for the store is dropped.
 */
export async function markSallaStoreUninstalled(sb: SupabaseClient, storeId: string, now = new Date()): Promise<void> {
  const { error } = await sb
    .from("merchants")
    .update({ ...CLEARED_TOKEN_STATE, uninstalled_at: now.toISOString() })
    .eq("salla_merchant_id", storeId);
  if (error) throw new Error(`Salla uninstall update failed: ${error.message}`);
  const { error: pendingError } = await sb.from("salla_installs").delete().eq("salla_merchant_id", storeId);
  if (pendingError) throw new Error(`Salla pending install cleanup failed: ${pendingError.message}`);
}
