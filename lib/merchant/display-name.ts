import type { Merchant } from "@/lib/types/database";

/**
 * The merchant's display name from real merchants columns (UI-017): the seller name, else the
 * Salla store name, else the store URL's host. "" when none is set. Client-safe.
 */
export function merchantDisplayName(
  merchant: Pick<Merchant, "seller_name" | "salla_store_name" | "store_url"> | null | undefined
): string {
  const name = merchant?.seller_name?.trim() || merchant?.salla_store_name?.trim();
  if (name) return name;
  const host = merchant?.store_url
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    ?.replace(/^www\./i, "");
  return host?.trim() ?? "";
}
