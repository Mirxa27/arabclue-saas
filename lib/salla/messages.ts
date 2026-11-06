/**
 * Fixed Arabic + English text for the stable codes the Salla routes return
 * (`{ error, code }` from /api/salla/products and /api/salla/installs/claim). Pages render these,
 * never the response's free text. Pure module — safe to import from client components.
 */
import { OAUTH_ERROR_MESSAGES } from "@/lib/oauth/errors";

export type BilingualText = { ar: string; en: string };

export const SALLA_ACTION_MESSAGES = {
  salla_not_connected: {
    ar: "متجر سلة غير مربوط بحسابك.",
    en: "Your Salla store isn't connected."
  },
  salla_reconnect_required: {
    ar: "انتهت صلاحية ربط سلة. أعد ربط متجرك.",
    en: "Your Salla access has expired. Reconnect your store."
  },
  salla_not_configured: {
    ar: "تكامل سلة غير مُعدّ على المنصّة بعد. اطلب من مسؤول المنصّة إضافة بيانات التطبيق.",
    en: "Salla isn't configured on the platform yet. Ask the platform admin to add the app credentials."
  },
  salla_refresh_busy: {
    ar: "جارٍ تحديث ربط سلة الآن. حاول بعد لحظات.",
    en: "The Salla connection is being refreshed. Try again in a moment."
  },
  salla_refresh_failed: {
    ar: "لم تُحدِّث سلة الربط. حاول بعد قليل.",
    en: "Salla didn't refresh the connection. Try again shortly."
  },
  install_not_found: {
    ar: "لم نجد تثبيتًا لتطبيقنا على سلة بالبريد الإلكتروني لحسابك.",
    en: "We couldn't find a Salla install made with your account's email."
  },
  store_already_linked: OAUTH_ERROR_MESSAGES.store_already_linked,
  email_not_confirmed: {
    ar: "أكّد بريدك الإلكتروني أولًا، ثم اربط متجر سلة.",
    en: "Confirm your email address first, then link your Salla store."
  },
  rate_limited: {
    ar: "محاولات كثيرة خلال وقت قصير. حاول بعد قليل.",
    en: "Too many attempts in a short time. Try again shortly."
  },
  not_signed_in: OAUTH_ERROR_MESSAGES.not_signed_in,
  network: {
    ar: "تعذّر الاتصال بالخادم. تحقّق من اتصالك وحاول مرة أخرى.",
    en: "Couldn't reach the server. Check your connection and try again."
  },
  unknown: {
    ar: "تعذّر إكمال العملية. حاول مرة أخرى.",
    en: "That didn't work. Please try again."
  }
} as const satisfies Record<string, BilingualText>;

export type SallaActionCode = keyof typeof SALLA_ACTION_MESSAGES;

export function sallaActionMessage(code: string | null | undefined): BilingualText {
  return code && Object.prototype.hasOwnProperty.call(SALLA_ACTION_MESSAGES, code)
    ? SALLA_ACTION_MESSAGES[code as SallaActionCode]
    : SALLA_ACTION_MESSAGES.unknown;
}
