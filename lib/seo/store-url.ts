/**
 * Validation of the store URL a merchant saves for the SEO audit (merchants.store_url).
 * Client-safe: the SEO page runs the same check before submitting; PUT /api/seo/site
 * re-runs it server-side together with the outbound guard's host checks.
 */
import type { Bilingual } from "@/lib/seo/audit-types";

export const STORE_URL_MAX = 2048;

export type StoreUrlResult = { ok: true; url: string } | { ok: false; code: StoreUrlError; message: Bilingual };

export type StoreUrlError = "empty" | "too_long" | "invalid" | "https_required" | "credentials" | "port";

const MESSAGES: Record<StoreUrlError, Bilingual> = {
  empty: { ar: "أدخل رابط متجرك", en: "Enter your store URL" },
  too_long: { ar: "الرابط طويل جداً", en: "The URL is too long" },
  invalid: { ar: "الرابط غير صالح", en: "That is not a valid URL" },
  https_required: { ar: "يجب أن يبدأ الرابط بـ https://", en: "The URL must use https://" },
  credentials: { ar: "لا يمكن أن يحتوي الرابط على اسم مستخدم أو كلمة مرور", en: "The URL must not contain a username or password" },
  port: { ar: "لا يمكن استخدام منفذ مخصص في رابط المتجر", en: "The store URL cannot use a custom port" }
};

const fail = (code: StoreUrlError): StoreUrlResult => ({ ok: false, code, message: MESSAGES[code] });

/**
 * Normalise a typed store URL: trims, adds https:// when no scheme was typed, requires https
 * on the default port, drops the #fragment, lower-cases the host. Host safety (public address,
 * no internal names) is checked server-side by parsePublicHttpUrl.
 */
export function normalizeStoreUrl(raw: string): StoreUrlResult {
  const text = raw.trim();
  if (!text) return fail("empty");
  if (text.length > STORE_URL_MAX) return fail("too_long");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return fail("invalid");
  }
  if (u.protocol !== "https:") return fail("https_required");
  if (u.username || u.password) return fail("credentials");
  if (u.port && u.port !== "443") return fail("port");
  if (!u.hostname || !u.hostname.includes(".")) return fail("invalid");
  u.hash = "";
  const href = u.toString();
  return href.length > STORE_URL_MAX ? fail("too_long") : { ok: true, url: href };
}
