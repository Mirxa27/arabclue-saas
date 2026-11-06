/**
 * Stable OAuth connect error codes and their fixed Arabic + English messages.
 *
 * Callbacks redirect with one of these codes only — provider, database and exception text
 * goes to reportError on the server. Result pages map the code to fixed text, with a
 * generic fallback, so a crafted `?error=<text>` link cannot put words on our pages.
 * Pure module — safe to import from client components.
 */

export const OAUTH_ERROR_CODES = [
  "provider_denied",
  "missing_code_or_state",
  "bad_state",
  "state_mismatch",
  "not_signed_in",
  "merchant_mismatch",
  "employee_not_found",
  "not_configured",
  "invalid_request",
  "unknown_provider",
  "token_exchange_failed",
  "account_lookup_failed",
  "store_already_linked",
  "save_failed",
  "unknown"
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export type OAuthErrorText = { ar: string; en: string };

export const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, OAuthErrorText> = {
  provider_denied: {
    ar: "أُلغي الربط أو لم تُمنح الصلاحيات المطلوبة في صفحة المزوّد.",
    en: "The connection was cancelled, or the requested permissions were not granted on the provider's page."
  },
  missing_code_or_state: {
    ar: "أعاد المزوّد استجابة غير مكتملة. ابدأ الربط من جديد.",
    en: "The provider returned an incomplete response. Start the connection again."
  },
  bad_state: {
    ar: "طلب الربط غير صالح أو انتهت صلاحيته. ابدأ الربط من جديد.",
    en: "This connection request is invalid or has expired. Start the connection again."
  },
  state_mismatch: {
    ar: "بدأت عملية الربط هذه في متصفح أو جلسة أخرى، فلم نُكملها. ابدأ الربط من جديد من هذا المتصفح.",
    en: "This connection was started in a different browser or session, so it was not completed. Start it again from this browser."
  },
  not_signed_in: {
    ar: "انتهت جلستك قبل اكتمال الربط. سجّل الدخول ثم أعد الربط.",
    en: "Your session ended before the connection finished. Sign in, then connect again."
  },
  merchant_mismatch: {
    ar: "أنت مسجّل الدخول بحساب مختلف عن الحساب الذي بدأ الربط، ولم يُربط أي شيء.",
    en: "You're signed in to a different account than the one that started this connection. Nothing was connected."
  },
  employee_not_found: {
    ar: "لم يُعثر على هذا الموظف الذكي في حسابك.",
    en: "That AI employee was not found on your account."
  },
  not_configured: {
    ar: "هذا التكامل غير مُعدّ على المنصّة بعد. اطلب من مسؤول المنصّة إضافة بيانات التطبيق.",
    en: "This integration isn't configured on the platform yet. Ask the platform admin to add its app credentials."
  },
  invalid_request: {
    ar: "طلب الربط غير صالح.",
    en: "The connection request was not valid."
  },
  unknown_provider: {
    ar: "هذا التكامل غير مدعوم.",
    en: "This integration isn't supported."
  },
  token_exchange_failed: {
    ar: "لم يقبل المزوّد التفويض. حاول الربط مرة أخرى.",
    en: "The provider didn't accept the authorization. Please try connecting again."
  },
  account_lookup_failed: {
    ar: "لم نجد حسابًا يمكننا إدارته بهذا الدخول (مثل حساب إنستغرام احترافي، أو رقم واتساب للأعمال، أو صفحة لينكدإن تديرها).",
    en: "We couldn't find an account we can manage with this login (for example an Instagram professional account, a WhatsApp Business number, or a LinkedIn page you administer)."
  },
  store_already_linked: {
    ar: "متجر سلة هذا مرتبط بالفعل بحساب آخر.",
    en: "This Salla store is already linked to another account."
  },
  save_failed: {
    ar: "تعذّر حفظ الربط. حاول مرة أخرى.",
    en: "We couldn't save the connection. Please try again."
  },
  unknown: {
    ar: "تعذّر إكمال الربط. حاول مرة أخرى.",
    en: "The connection could not be completed. Please try again."
  }
};

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === "string" && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** Fixed message for a code; anything unrecognised gets the generic message. */
export function oauthErrorMessage(code: string | null | undefined): OAuthErrorText {
  return isOAuthErrorCode(code) ? OAUTH_ERROR_MESSAGES[code] : OAUTH_ERROR_MESSAGES.unknown;
}

/** Thrown inside callback steps to choose the stable code reported to the browser. */
export class OAuthCallbackError extends Error {
  readonly code: OAuthErrorCode;
  constructor(code: OAuthErrorCode, cause?: unknown) {
    super(`OAuth callback failed: ${code}`, cause === undefined ? undefined : { cause });
    this.name = "OAuthCallbackError";
    this.code = code;
  }
}

/**
 * What to hand reportError for a failed callback: the underlying Error when there is one
 * (provider/HTTP failure), otherwise a stand-in, with non-Error details (e.g. a PostgREST
 * error object) moved into `extra.detail`, which reportError redacts before logging.
 */
export function oauthFailureReport(code: OAuthErrorCode, detail?: unknown): { error: Error; detail?: unknown } {
  const cause = detail instanceof OAuthCallbackError && detail.cause !== undefined ? detail.cause : detail;
  if (cause instanceof Error) return { error: cause };
  return { error: new OAuthCallbackError(code), ...(cause === undefined ? {} : { detail: cause }) };
}
