/**
 * arabclue's own commercial-registration details for the public /maroof page (UI-035).
 *
 * COMPANY_CR_NUMBER and MAROOF_URL are server-only settings: managed in /admin/config
 * (lib/admin/secret-registry.ts, "Company") and hydrated into process.env at runtime by
 * instrumentation.ts, so the page reads them per request instead of baking them in at build.
 * Malformed values are treated as unset — the page then shows its neutral fallback rather
 * than a wrong registration number or link.
 */
import { toAsciiDigits } from "@/lib/i18n/digits";

export type CompanyRegistration = {
  /** 10-digit Saudi commercial registration number. */
  crNumber: string | null;
  /** https link to the company's Maroof profile. */
  maroofUrl: string | null;
};

export function parseCrNumber(raw: string | undefined): string | null {
  const digits = toAsciiDigits(raw ?? "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

export function parseMaroofUrl(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text || text.length > 2048) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function readCompanyRegistration(env: Record<string, string | undefined> = process.env): CompanyRegistration {
  return {
    crNumber: parseCrNumber(env.COMPANY_CR_NUMBER),
    maroofUrl: parseMaroofUrl(env.MAROOF_URL)
  };
}
