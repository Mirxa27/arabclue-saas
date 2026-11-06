/**
 * Phone numbers on the voice path. Client-safe (no server imports).
 *
 *  - normalizePhoneE164: merchant/caller input → E.164 (Arabic-Indic digits, spaces, dashes and
 *    the Saudi local forms 05xxxxxxxx / 5xxxxxxxx / 9665xxxxxxxx / 009665… are accepted).
 *  - maskPhone: what the platform events log keeps of a caller's number (SW-45).
 *  - Salla order ownership (SW-23): Salla stores a customer's mobile as the national number
 *    without its leading 0 plus `mobile_code` (documented example on docs.salla.dev/orders/list.md:
 *    `mobile: 557777777`, `mobile_code: '+966'`); customerPhoneDigits rebuilds the international
 *    digits so they can be compared with the caller id Twilio verified.
 */
import { toAsciiDigits } from "@/lib/i18n/digits";

/** E.164: "+", a non-zero country code digit, 8–15 digits in total. */
export const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isE164(value: unknown): value is string {
  return typeof value === "string" && E164_RE.test(value);
}

/** Only the digits of `value` (Arabic-Indic digits converted). */
export function phoneDigits(value: unknown): string {
  if (value === null || value === undefined) return "";
  return toAsciiDigits(String(value)).replace(/\D/g, "");
}

/** E.164 for a phone number typed by a merchant or spoken by a caller; null when it is not dialable. */
export function normalizePhoneE164(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const compact = toAsciiDigits(input).replace(/[^\d+]/g, "");
  if (!compact || compact.length > 20) return null;
  let candidate: string | null = null;
  if (/^\+\d+$/.test(compact)) candidate = compact;
  else if (/^00[1-9]\d+$/.test(compact)) candidate = `+${compact.slice(2)}`;
  else if (/^05\d{8}$/.test(compact)) candidate = `+966${compact.slice(1)}`;
  else if (/^5\d{8}$/.test(compact)) candidate = `+966${compact}`;
  else if (/^9665\d{8}$/.test(compact)) candidate = `+${compact}`;
  return candidate && E164_RE.test(candidate) ? candidate : null;
}

/** "•••• 4567" — the last four digits only. */
export function maskPhone(value: string | null | undefined): string | null {
  const digits = phoneDigits(value);
  if (!digits) return null;
  return `•••• ${digits.slice(-4)}`;
}

/** International digits (country code + national number) of a Salla order's customer. */
export function customerPhoneDigits(mobile: unknown, mobileCode: unknown): string | null {
  const code = phoneDigits(mobileCode);
  const national = phoneDigits(mobile).replace(/^0+/, "");
  if (!national) return null;
  if (code && national.length >= 11 && national.startsWith(code)) return national; // already international
  return `${code}${national}`;
}

// Country calling codes the platform's callers mostly come from (GCC, Levant, North Africa);
// used only to pick a narrower Salla search keyword — ownership is decided by full equality.
const THREE_DIGIT_CODES = ["966", "971", "965", "974", "973", "968", "962", "961", "963", "964", "967", "970", "212", "213", "216", "218", "249"];

/**
 * The national part of an E.164 caller id, the way Salla stores `customer.mobile` — the
 * `keyword` value for GET /orders (docs.salla.dev/orders/list.md: keyword searches
 * customer.mobile, customer.name, shipping_number, reference_id and tag_name).
 */
export function phoneSearchKeyword(e164: string): string {
  const digits = phoneDigits(e164);
  const code = THREE_DIGIT_CODES.find((c) => digits.startsWith(c));
  if (code) return digits.slice(code.length).replace(/^0+/, "");
  if (digits.startsWith("20") || digits.startsWith("44") || digits.startsWith("91") || digits.startsWith("92")) {
    return digits.slice(2).replace(/^0+/, "");
  }
  if (digits.startsWith("1")) return digits.slice(1);
  return digits.slice(-9);
}
