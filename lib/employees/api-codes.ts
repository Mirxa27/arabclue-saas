/**
 * Stable refusal codes of the AI-employee API, with fixed Arabic + English copy.
 *
 * Routes answer `{ error: <English message>, code: EmployeeApiCode }` (plus the fields
 * documented per code below). Clients map `code` to EMPLOYEE_API_COPY — never show a raw
 * provider/database message on its own. Pure and client-safe (no server imports).
 */

export const EMPLOYEE_API_CODES = [
  /** 402 — the merchant's plan / subscription does not include AI employees. */
  "plan_required",
  /** 402 — this employee's seat is not paid (trial ended, payment overdue or canceled). Body adds `billing_status`. */
  "seat_unpaid",
  /** 402 — the plan's employee seat limit is reached. Body adds `limit`. */
  "seat_limit",
  /** 409 — the employee is paused or offboarded; resume it first. */
  "employee_inactive",
  /** 409 — the merchant must accept the current DPA before connecting a customer-facing channel. Body adds `dpa_version`. */
  "dpa_required",
  /** 409 — the merchant already has this role under this name. */
  "duplicate_employee",
  /** 404 — no such conversation for this employee. */
  "conversation_not_found",
  /** 404 — no such integration on this employee. */
  "integration_not_found",
  /** 400 — the credentials do not match what the channel needs (message says which field). */
  "invalid_credentials",
  /** 400 — the webhook URL is not a public http(s) address. */
  "webhook_url_blocked",
  /** 400 — the email channel needs the merchant's own Resend API key and sender address. */
  "email_sender_required",
  /** 400 — the sender's domain is not verified in the merchant's Resend account. */
  "email_domain_unverified",
  /** 400 — the sender address is on the platform's own domain. */
  "email_sender_forbidden",
  /** 502 — the provider could not be asked (try again). */
  "provider_unavailable"
] as const;

export type EmployeeApiCode = (typeof EMPLOYEE_API_CODES)[number];

export const EMPLOYEE_API_COPY: Record<EmployeeApiCode, { ar: string; en: string }> = {
  plan_required: {
    ar: "الموظفون الأذكياء غير متاحين في باقتك الحالية أو اشتراكك غير نشط. رقِّ باقتك أو جدّد اشتراكك لتشغيلهم.",
    en: "AI employees are not included in your current plan, or your subscription is not active. Upgrade or renew to run them."
  },
  seat_unpaid: {
    ar: "انتهت الفترة التجريبية لهذا الموظف أو لم تُسدَّد رسوم مقعده. ادفع رسوم المقعد لإعادة تشغيله.",
    en: "This employee's trial has ended or its seat is unpaid. Pay for the seat to run it again."
  },
  seat_limit: {
    ar: "وصلت إلى الحد الأقصى لعدد الموظفين في باقتك. رقِّ باقتك أو أنهِ عمل موظف آخر أولًا.",
    en: "You have reached your plan's employee limit. Upgrade, or offboard another employee first."
  },
  employee_inactive: {
    ar: "هذا الموظف متوقف حاليًا. استأنف عمله أولًا.",
    en: "This employee is paused. Resume it first."
  },
  dpa_required: {
    ar: "يجب الموافقة على اتفاقية معالجة البيانات المحدّثة قبل ربط قناة يتواصل فيها الموظف مع عملائك.",
    en: "Accept the updated Data Processing Agreement before connecting a channel where the employee talks to your customers."
  },
  duplicate_employee: {
    ar: "لديك موظف بنفس الدور والاسم. اختر اسمًا آخر.",
    en: "You already have an employee with this role and name. Choose another name."
  },
  conversation_not_found: {
    ar: "لم يُعثر على هذه المحادثة لدى هذا الموظف.",
    en: "That conversation was not found for this employee."
  },
  integration_not_found: {
    ar: "هذا الربط غير موجود لدى هذا الموظف.",
    en: "That integration is not set up on this employee."
  },
  invalid_credentials: {
    ar: "بيانات الربط غير مكتملة أو غير صحيحة. راجع الحقول المطلوبة.",
    en: "The connection details are incomplete or invalid. Check the required fields."
  },
  webhook_url_blocked: {
    ar: "رابط الـ Webhook يجب أن يكون عنوان http(s) عامًا على الإنترنت، لا عنوانًا داخليًا أو خاصًا.",
    en: "The webhook URL must be a public http(s) address, not an internal or private one."
  },
  email_sender_required: {
    ar: "قناة البريد تحتاج مفتاح Resend الخاص بمتجرك وعنوان المرسل من نطاقك.",
    en: "The email channel needs your own Resend API key and a sender address on your domain."
  },
  email_domain_unverified: {
    ar: "نطاق عنوان المرسل غير موثّق في حسابك على Resend. وثّق النطاق ثم أعد الربط.",
    en: "The sender's domain is not verified in your Resend account. Verify the domain, then connect again."
  },
  email_sender_forbidden: {
    ar: "لا يمكن الإرسال باسم نطاق المنصة. استخدم عنوانًا من نطاق متجرك.",
    en: "You cannot send as the platform's domain. Use an address on your own domain."
  },
  provider_unavailable: {
    ar: "تعذّر الاتصال بمزوّد الخدمة الآن. حاول مرة أخرى بعد قليل.",
    en: "The provider could not be reached right now. Try again in a moment."
  }
};

export function employeeApiCopy(code: unknown): { ar: string; en: string } | null {
  return typeof code === "string" && (EMPLOYEE_API_CODES as readonly string[]).includes(code)
    ? EMPLOYEE_API_COPY[code as EmployeeApiCode]
    : null;
}
