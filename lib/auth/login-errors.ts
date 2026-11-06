/**
 * Stable sign-in error codes and their fixed Arabic + English messages.
 *
 * The auth callback routes and the OTP endpoint only ever hand these codes to the browser;
 * Supabase's own `error_description` text (and anything else from the URL) is never shown,
 * so a crafted `/login?error=<text>` link cannot put words on our page. Unknown codes get
 * the generic message. Pure module — safe to import from client components.
 */

export const LOGIN_ERROR_CODES = [
  "link_expired",
  "link_other_browser",
  "link_invalid",
  "access_denied",
  "session_failed",
  "rate_limited",
  "invalid_email",
  "signup_disabled",
  "account_blocked",
  "auth_unavailable",
  "unknown"
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export type BilingualText = { ar: string; en: string };

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, BilingualText> = {
  link_expired: {
    ar: "انتهت صلاحية رابط الدخول أو سبق استخدامه. اطلب رابطًا جديدًا.",
    en: "This sign-in link has expired or was already used. Request a new one."
  },
  link_other_browser: {
    ar: "فُتح الرابط في متصفح أو جهاز غير الذي طُلب منه، أو وصلك رابط أحدث. افتح أحدث رابط في المتصفح نفسه، أو اطلب رابطًا جديدًا من هنا.",
    en: "This link was opened in a different browser or device than the one that requested it, or a newer link was sent. Open the latest link in the same browser, or request a new one here."
  },
  link_invalid: {
    ar: "رابط الدخول غير صالح. اطلب رابطًا جديدًا.",
    en: "This sign-in link is not valid. Request a new one."
  },
  access_denied: {
    ar: "أُلغي تسجيل الدخول أو رُفض.",
    en: "Sign-in was cancelled or denied."
  },
  session_failed: {
    ar: "تعذّر إكمال تسجيل الدخول من هذا الرابط. اطلب رابطًا جديدًا.",
    en: "We couldn't finish signing you in from that link. Request a new one."
  },
  rate_limited: {
    ar: "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.",
    en: "Too many attempts. Wait a moment and try again."
  },
  invalid_email: {
    ar: "أدخل بريدًا إلكترونيًا صحيحًا.",
    en: "Enter a valid email address."
  },
  signup_disabled: {
    ar: "الدخول بالبريد الإلكتروني غير متاح حاليًا.",
    en: "Email sign-in is currently unavailable."
  },
  account_blocked: {
    ar: "هذا الحساب موقوف. تواصل مع الدعم.",
    en: "This account is suspended. Please contact support."
  },
  auth_unavailable: {
    ar: "خدمة تسجيل الدخول غير متاحة مؤقتًا. حاول بعد قليل.",
    en: "Sign-in is temporarily unavailable. Please try again shortly."
  },
  unknown: {
    ar: "تعذّر تسجيل الدخول. اطلب رابطًا جديدًا وحاول مرة أخرى.",
    en: "We couldn't sign you in. Request a new link and try again."
  }
};

export function isLoginErrorCode(value: unknown): value is LoginErrorCode {
  return typeof value === "string" && (LOGIN_ERROR_CODES as readonly string[]).includes(value);
}

/** Fixed message for a code; anything unrecognised gets the generic message. */
export function loginErrorMessage(code: string | null | undefined): BilingualText {
  return isLoginErrorCode(code) ? LOGIN_ERROR_MESSAGES[code] : LOGIN_ERROR_MESSAGES.unknown;
}

// Supabase Auth (GoTrue / auth-js) error codes → our stable codes.
const AUTH_CODE_MAP: Record<string, LoginErrorCode> = {
  otp_expired: "link_expired",
  flow_state_expired: "link_expired",
  flow_state_not_found: "link_expired",
  pkce_code_verifier_not_found: "link_other_browser",
  bad_code_verifier: "link_other_browser",
  validation_failed: "link_invalid",
  bad_jwt: "link_invalid",
  invite_not_found: "link_invalid",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  email_address_invalid: "invalid_email",
  email_address_not_authorized: "invalid_email",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  otp_disabled: "signup_disabled",
  user_banned: "account_blocked",
  unexpected_failure: "auth_unavailable",
  request_timeout: "auth_unavailable",
  hook_timeout: "auth_unavailable",
  hook_timeout_after_retry: "auth_unavailable"
};

/** Map a Supabase Auth error (auth-js AuthError or GoTrue error_code) to a stable code. */
export function loginErrorFromAuthError(err: {
  code?: string | null;
  status?: number | null;
  name?: string | null;
}): LoginErrorCode {
  const mapped = err.code ? AUTH_CODE_MAP[err.code] : undefined;
  if (mapped) return mapped;
  // auth-js reports network failures / gateway errors as AuthRetryableFetchError (status 0 or 5xx).
  if (err.name === "AuthRetryableFetchError" || err.status === 0) return "auth_unavailable";
  if (err.status === 429) return "rate_limited";
  if (typeof err.status === "number" && err.status >= 500) return "auth_unavailable";
  return "unknown";
}

/**
 * Supabase appends `error`, `error_code` and `error_description` (query for PKCE links,
 * fragment for implicit links) when it rejects a link. Returns the stable code, or null
 * when the URL carries no error. `error_description` is deliberately ignored.
 */
export function loginErrorFromRedirectParams(params: { get(name: string): string | null }): LoginErrorCode | null {
  const errorCode = params.get("error_code");
  const error = params.get("error");
  if (!errorCode && !error) return null;
  if (errorCode) {
    const mapped = loginErrorFromAuthError({ code: errorCode });
    if (mapped !== "unknown") return mapped;
  }
  if (error === "access_denied") return "access_denied";
  if (error === "server_error" || error === "temporarily_unavailable") return "auth_unavailable";
  return "unknown";
}
