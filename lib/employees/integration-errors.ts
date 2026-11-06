/**
 * Why a channel integration was flagged `status = 'error'` — stored in
 * `ai_employee_integrations.config.error` and shown in the employee workspace.
 *
 * Pure and client-safe (no server imports): components can import the copy table.
 *
 * Contract (written by lib/employees/integration-store.ts → markIntegrationError):
 *   config.error = {
 *     reason: IntegrationErrorReason,   // stable code — map it to copy, never show `detail` alone
 *     source: "send",                   // what detected it
 *     graph_code?: number, graph_subcode?: number,   // Meta's numeric error code / subcode
 *     detail?: string,                  // provider message, redacted, ≤ 300 chars (English)
 *     at: string                        // ISO timestamp
 *   }
 * Reconnecting the channel (POST /api/employees/:id/integrations) rebuilds `config`
 * and sets status back to 'connected', which clears the error.
 */

export type IntegrationErrorReason =
  | "token_invalid"
  | "permission_missing"
  | "instagram_access_disabled"
  | "page_restricted"
  | "instagram_not_linked"
  | "capability_missing"
  | "account_not_eligible";

export type IntegrationErrorInfo = {
  reason: IntegrationErrorReason;
  source: "send";
  graph_code?: number;
  graph_subcode?: number;
  detail?: string;
  at: string;
};

export const INTEGRATION_ERROR_COPY: Record<IntegrationErrorReason, { ar: string; en: string }> = {
  token_invalid: {
    ar: "انتهت صلاحية رمز الوصول للصفحة أو أُلغي. أنشئ رمزًا جديدًا من تطبيقك في Meta ثم أعد الربط.",
    en: "The Page access token expired or was revoked. Generate a new one in your Meta app and reconnect."
  },
  permission_missing: {
    ar: "تطبيقك في Meta لا يملك صلاحية المراسلة (pages_messaging / instagram_manage_messages) أو لم يُنشر بعد. راجع الصلاحيات والوصول المتقدم ثم أعد الربط.",
    en: "Your Meta app lacks messaging permission (pages_messaging / instagram_manage_messages) or is not live. Check permissions and Advanced Access, then reconnect."
  },
  instagram_access_disabled: {
    ar: "حساب إنستغرام أوقف وصول التطبيقات إلى الرسائل. فعّل «السماح بالوصول إلى الرسائل» من إعدادات الرسائل في تطبيق إنستغرام ثم أعد الربط.",
    en: "The Instagram account has turned off message access for apps. Enable \"Allow access to messages\" in Instagram's message controls, then reconnect."
  },
  page_restricted: {
    ar: "Meta قيّدت إرسال الرسائل من هذه الصفحة أو هذا النشاط التجاري مؤقتًا. راجع جودة الصفحة في Meta Business Suite.",
    en: "Meta has temporarily restricted messaging from this Page or business. Check Page quality in Meta Business Suite."
  },
  instagram_not_linked: {
    ar: "حساب إنستغرام غير مرتبط بالصفحة أو تعذّر التحقق من الربط. اربط الحساب الاحترافي بالصفحة ثم أعد الربط.",
    en: "The Instagram account is not linked to the Page (or the link could not be verified). Link the professional account to the Page and reconnect."
  },
  capability_missing: {
    ar: "تطبيقك في Meta لا يملك ميزة المراسلة المطلوبة. أضف منتج Messenger أو Instagram إلى التطبيق.",
    en: "Your Meta app does not have the messaging capability. Add the Messenger or Instagram product to the app."
  },
  account_not_eligible: {
    ar: "هذا الحساب غير مؤهل بعد لواجهة المراسلة من Meta.",
    en: "This account is not yet eligible for Meta's messaging API."
  }
};

const REASONS = new Set<string>(Object.keys(INTEGRATION_ERROR_COPY));

/** Read `config.error` defensively (it is jsonb). Returns null when absent or unrecognised. */
export function readIntegrationError(config: unknown): IntegrationErrorInfo | null {
  if (!config || typeof config !== "object") return null;
  const raw = (config as { error?: unknown }).error;
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.reason !== "string" || !REASONS.has(e.reason) || typeof e.at !== "string") return null;
  return {
    reason: e.reason as IntegrationErrorReason,
    source: "send",
    ...(typeof e.graph_code === "number" ? { graph_code: e.graph_code } : {}),
    ...(typeof e.graph_subcode === "number" ? { graph_subcode: e.graph_subcode } : {}),
    ...(typeof e.detail === "string" ? { detail: e.detail } : {}),
    at: e.at
  };
}
