/**
 * Version of the Data Processing Agreement published at /legal/dpa. Stored in
 * merchants.dpa_version when a merchant accepts it (onboarding or the dashboard
 * re-acceptance banner) — bump it together with the page text.
 *
 * 2026-11: AI employees answering the merchant's customers on messaging channels,
 * the complete sub-processor list (incl. Hostinger, Resend, Meta, Salla, Wathq),
 * accurate retention/deletion terms.
 */
export const CURRENT_DPA_VERSION = "2026-11";
export const DPA_LAST_UPDATED = "November 2026";

/** True when the merchant has not accepted the current DPA version. */
export function merchantNeedsDpaAcceptance(merchant: { dpa_version?: string | null } | null | undefined): boolean {
  if (!merchant) return false;
  return merchant.dpa_version !== CURRENT_DPA_VERSION;
}
