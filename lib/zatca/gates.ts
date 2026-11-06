/**
 * Who may use ZATCA e-invoicing right now (SW-2). Lite's only paid module is ZATCA, so onboarding,
 * issuing (incl. Salla order invoicing) and resubmission all require:
 *   1. the platform kill switch features.zatca (admin → platform settings) to be on;
 *   2. merchantCanUseFeature(merchant, "zatca"): a plan with ZATCA and an active or past-due
 *      (grace) subscription;
 *   3. a configured ZATCA environment (lib/zatca/config.ts).
 * Reading existing invoices (list, detail, downloads, CSV) is never gated: they are the merchant's
 * legal records.
 */
import { HttpError } from "@/lib/api/errors";
import { getFeatureSettings } from "@/lib/admin/platform-settings";
import { featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import type { Merchant } from "@/lib/types/database";
import { getZatcaConfig, ZatcaConfigError, type ZatcaConfig } from "@/lib/zatca/config";
import { reportError } from "@/lib/observability/error-reporter";

export type ZatcaBlockReason = "zatca_disabled" | "not_entitled" | "zatca_not_configured";

export type ZatcaAccess = { ok: true; config: ZatcaConfig } | { ok: false; reason: ZatcaBlockReason; status: 402 | 503; message: string };

const MESSAGES: Record<ZatcaBlockReason, string> = {
  zatca_disabled: "ZATCA e-invoicing is temporarily disabled by the platform. / الفوترة الإلكترونية معطّلة مؤقتاً من المنصة.",
  not_entitled: `${featureGateMessage("zatca")} / تتطلب الفوترة الإلكترونية (زاتكا) اشتراكاً فعّالاً.`,
  zatca_not_configured: "ZATCA e-invoicing is not configured on this deployment. / لم يتم إعداد الربط مع زاتكا على هذه المنصة."
};

export function zatcaBlockMessage(reason: ZatcaBlockReason): string {
  return MESSAGES[reason];
}

/** The configured environment, or null — a misconfiguration is reported and treated as "not configured". */
export function readZatcaConfig(): ZatcaConfig | null {
  try {
    return getZatcaConfig();
  } catch (err) {
    if (err instanceof ZatcaConfigError) {
      reportError(err, { extra: { step: "zatca config" } });
      return null;
    }
    throw err;
  }
}

export async function zatcaAccess(merchant: Pick<Merchant, "plan" | "subscription_status">): Promise<ZatcaAccess> {
  const features = await getFeatureSettings();
  if (features.zatca === false) return { ok: false, reason: "zatca_disabled", status: 503, message: MESSAGES.zatca_disabled };
  if (!merchantCanUseFeature(merchant, "zatca")) return { ok: false, reason: "not_entitled", status: 402, message: MESSAGES.not_entitled };
  const config = readZatcaConfig();
  if (!config) return { ok: false, reason: "zatca_not_configured", status: 503, message: MESSAGES.zatca_not_configured };
  return { ok: true, config };
}

/** Route helper: the config, or an HttpError 402 (plan_required) / 503. */
export async function requireZatcaAccess(merchant: Pick<Merchant, "plan" | "subscription_status">): Promise<ZatcaConfig> {
  const access = await zatcaAccess(merchant);
  if (!access.ok) throw new HttpError(access.status, access.message, access.reason === "not_entitled" ? "plan_required" : access.reason);
  return access.config;
}
