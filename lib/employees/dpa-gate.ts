/**
 * DPA gate for customer-facing channels.
 *
 * Connecting a channel on which an AI employee talks to (and processes the personal data of)
 * the merchant's customers requires the current Data Processing Agreement — the 2026-11
 * version is the one that covers AI employees on messaging channels (lib/legal/dpa.ts).
 * Manual connects / credential updates answer 409 `dpa_required`; the one-click OAuth start
 * redirects back with `oauth=error&oauth_note=dpa_required`.
 */
import { CURRENT_DPA_VERSION, merchantNeedsDpaAcceptance } from "@/lib/legal/dpa";
import { EmployeeApiError } from "./http";
import type { IntegrationKind } from "./types";

/** Channels where the employee exchanges messages with the merchant's customers. */
export const CUSTOMER_FACING_CHANNELS: ReadonlySet<IntegrationKind> = new Set([
  "whatsapp",
  "telegram",
  "twilio_sms",
  "meta",
  "instagram",
  "email",
  "gmail"
]);

export function channelNeedsDpa(kind: IntegrationKind, merchant: { dpa_version?: string | null } | null | undefined): boolean {
  return CUSTOMER_FACING_CHANNELS.has(kind) && merchantNeedsDpaAcceptance(merchant ?? { dpa_version: null });
}

export function assertDpaForChannel(kind: IntegrationKind, merchant: { dpa_version?: string | null } | null | undefined): void {
  if (channelNeedsDpa(kind, merchant)) {
    throw new EmployeeApiError(
      409,
      "dpa_required",
      "Accept the updated Data Processing Agreement before connecting a channel where the employee talks to your customers.",
      { dpa_version: CURRENT_DPA_VERSION }
    );
  }
}
