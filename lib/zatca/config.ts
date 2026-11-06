/**
 * Which ZATCA Fatoora environment this deployment talks to.
 *
 *   ZATCA_ENVIRONMENT   sandbox | simulation | production
 *   ZATCA_FATOORA_BASE  optional explicit API base (overrides the environment's default URL; when
 *                       ZATCA_ENVIRONMENT is unset the environment is read from the URL path)
 *
 * Neither set → e-invoicing is "not configured": onboarding and submission answer 503 and Salla
 * orders wait in the pending queue. There is no platform-wide credential: every merchant onboards
 * its own EGS unit (lib/zatca/onboarding.ts).
 *
 * Base URLs: data/research/zatca-phase2.md §Environments.
 */
export type ZatcaEnvironment = "sandbox" | "simulation" | "production";

export const ZATCA_ENVIRONMENTS: readonly ZatcaEnvironment[] = ["sandbox", "simulation", "production"];

export const ZATCA_BASE_URLS: Record<ZatcaEnvironment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core"
};

/** The OTP ZATCA documents for its developer-portal sandbox (any CSR, any VAT number). */
export const ZATCA_SANDBOX_OTP = "123345";

export type ZatcaConfig = { environment: ZatcaEnvironment; baseUrl: string };

function environmentFromUrl(url: string): ZatcaEnvironment | null {
  if (/\/developer-portal\/?$/.test(url)) return "sandbox";
  if (/\/simulation\/?$/.test(url)) return "simulation";
  if (/\/core\/?$/.test(url)) return "production";
  return null;
}

export class ZatcaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZatcaConfigError";
  }
}

/** The configured environment, or null when ZATCA is not configured. Throws on a contradictory setup. */
export function getZatcaConfig(env: Record<string, string | undefined> = process.env): ZatcaConfig | null {
  const rawEnv = env.ZATCA_ENVIRONMENT?.trim().toLowerCase() || "";
  const rawBase = env.ZATCA_FATOORA_BASE?.trim().replace(/\/+$/, "") || "";
  if (!rawEnv && !rawBase) return null;

  let environment: ZatcaEnvironment | null = null;
  if (rawEnv) {
    if (!(ZATCA_ENVIRONMENTS as readonly string[]).includes(rawEnv)) {
      throw new ZatcaConfigError(`ZATCA_ENVIRONMENT must be sandbox, simulation or production (got "${rawEnv}")`);
    }
    environment = rawEnv as ZatcaEnvironment;
  }
  if (rawBase) {
    let url: URL;
    try {
      url = new URL(rawBase);
    } catch {
      throw new ZatcaConfigError("ZATCA_FATOORA_BASE is not a valid URL");
    }
    if (url.protocol !== "https:") throw new ZatcaConfigError("ZATCA_FATOORA_BASE must use https");
    const fromUrl = environmentFromUrl(rawBase);
    if (!environment) {
      if (!fromUrl) {
        throw new ZatcaConfigError("Set ZATCA_ENVIRONMENT: the environment cannot be derived from ZATCA_FATOORA_BASE");
      }
      environment = fromUrl;
    } else if (fromUrl && fromUrl !== environment) {
      throw new ZatcaConfigError(`ZATCA_FATOORA_BASE points at ${fromUrl} but ZATCA_ENVIRONMENT is ${environment}`);
    }
    return { environment, baseUrl: rawBase };
  }
  return { environment: environment!, baseUrl: ZATCA_BASE_URLS[environment!] };
}
