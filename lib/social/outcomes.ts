/**
 * Per-platform publishing outcomes (social_posts.publish_results) and how they roll up into
 * the post's status. Pure and client-safe: the scheduler writes these, the post drawer reads
 * them, and the bilingual labels below are what the merchant sees.
 *
 *   sending    written *before* the provider call; never left behind by a run that finished
 *   published  the provider confirmed the post (remoteId set)
 *   failed     the provider was asked and said no (code + provider message)
 *   skipped    nothing was sent (not connected, no image, unsupported, …)
 *   unknown    a run stopped after sending — the post may or may not exist on the platform;
 *              it is never retried automatically (that is how double posts happen)
 */
import { z } from "zod";
import { SOCIAL_PLATFORMS, type Platform } from "./types";

export const PLATFORM_RESULT_STATUSES = ["sending", "published", "failed", "skipped", "unknown"] as const;
export type PlatformResultStatus = (typeof PLATFORM_RESULT_STATUSES)[number];

export const PUBLISH_CODES = [
  // skipped: nothing was sent
  "not_connected",
  "reconnect_required",
  "no_copy",
  "no_image",
  "unsupported",
  "caption_too_long",
  // failed: the provider refused
  "auth_failed",
  "rate_limited",
  "duplicate",
  "rejected",
  "provider_error",
  // unknown
  "outcome_unknown"
] as const;
export type PublishCode = (typeof PUBLISH_CODES)[number];

export type PlatformResult = {
  status: PlatformResultStatus;
  remoteId?: string;
  code?: PublishCode;
  /** Provider / reason text for the merchant (English, already redacted, ≤ 300 chars). */
  message?: string;
  at: string;
};

export type PublishResults = Partial<Record<Platform, PlatformResult>>;

const PlatformResultSchema = z.object({
  status: z.enum(PLATFORM_RESULT_STATUSES),
  remoteId: z.string().min(1).max(512).optional(),
  code: z.enum(PUBLISH_CODES).optional(),
  message: z.string().max(1000).optional(),
  at: z.string().max(64)
});

/** Defensive read of a stored publish_results value (owners can write the column directly). */
export function parsePublishResults(value: unknown): PublishResults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PublishResults = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const parsed = PlatformResultSchema.safeParse((value as Record<string, unknown>)[platform]);
    if (parsed.success) out[platform] = parsed.data;
  }
  return out;
}

/** Defensive read of social_posts.remote_ids ({platform: id}). */
export function parseRemoteIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if ((SOCIAL_PLATFORMS as readonly string[]).includes(key) && typeof id === "string" && id) out[key] = id;
  }
  return out;
}

/** Post-level codes stored in social_posts.error_code. */
export const POST_ERROR_CODES = [
  "partial",
  "not_published",
  "outcome_unknown",
  "plan_required",
  "missed_window",
  "too_many_attempts",
  "replaced"
] as const;
export type PostErrorCode = (typeof POST_ERROR_CODES)[number];

export type PostOutcome = {
  status: "published" | "failed";
  errorCode: PostErrorCode | null;
  /** English summary for logs and the drawer's detail line; null when everything published. */
  error: string | null;
  publishedAt: string | null;
};

const describe = (platform: Platform, r: PlatformResult): string => {
  const reason = r.message ?? r.code ?? r.status;
  return `${platform}: ${r.status === "skipped" ? "skipped" : r.status} (${reason})`;
};

/**
 * Roll the per-platform results up into the post status:
 *  - anything published → 'published' (the post is live), with a 'partial' note listing the rest
 *  - nothing published, something unknown → 'failed' / outcome_unknown (check before re-queueing)
 *  - nothing published → 'failed' / not_published with every platform's reason
 */
export function summarizeOutcome(platforms: readonly Platform[], results: PublishResults): PostOutcome {
  const targets = [...new Set(platforms)];
  const published = targets.filter((p) => results[p]?.status === "published");
  const rest = targets.filter((p) => results[p]?.status !== "published");
  const publishedAt =
    published
      .map((p) => results[p]!.at)
      .filter((at) => Number.isFinite(Date.parse(at)))
      .sort()[0] ?? null;

  const restText = rest
    .map((p) => (results[p] ? describe(p, results[p]!) : `${p}: not attempted`))
    .join("; ");

  if (published.length > 0) {
    if (rest.length === 0) return { status: "published", errorCode: null, error: null, publishedAt };
    return { status: "published", errorCode: "partial", error: `Partially published — ${restText}`, publishedAt };
  }
  if (rest.some((p) => results[p]?.status === "unknown")) {
    return { status: "failed", errorCode: "outcome_unknown", error: `Outcome unknown — ${restText}`, publishedAt: null };
  }
  return {
    status: "failed",
    errorCode: "not_published",
    error: `Not published — ${restText || "no target platforms"}`,
    publishedAt: null
  };
}

// ─── Merchant-facing copy ────────────────────────────────────────────────────

export type BilingualText = { ar: string; en: string };

export const PLATFORM_STATUS_TEXT: Record<PlatformResultStatus, BilingualText> = {
  sending: { ar: "جارٍ النشر", en: "Sending" },
  published: { ar: "نُشر", en: "Published" },
  failed: { ar: "فشل", en: "Failed" },
  skipped: { ar: "لم يُرسل", en: "Not sent" },
  unknown: { ar: "غير مؤكد", en: "Unconfirmed" }
};

export const PUBLISH_CODE_TEXT: Record<PublishCode, BilingualText> = {
  not_connected: { ar: "الحساب غير مربوط.", en: "The account isn't connected." },
  reconnect_required: {
    ar: "انتهت صلاحية الربط. أعد ربط الحساب من صفحة التكاملات.",
    en: "The connection expired. Reconnect the account on the Integrations page."
  },
  no_copy: { ar: "لا يوجد نص لهذه المنصّة.", en: "There's no caption for this platform." },
  no_image: {
    ar: "إنستغرام يحتاج صورة (JPEG) من منتجاتك. أضف صورة أو احذف إنستغرام من المنشور.",
    en: "Instagram needs an image (JPEG) from your catalog. Add one or remove Instagram from this post."
  },
  unsupported: {
    ar: "النشر على هذه المنصّة غير متاح بعد.",
    en: "Publishing to this platform isn't available yet."
  },
  caption_too_long: { ar: "النص أطول من الحد المسموح للمنصّة.", en: "The caption is over the platform's limit." },
  auth_failed: { ar: "رفضت المنصّة صلاحيات الحساب.", en: "The platform rejected the account's permissions." },
  rate_limited: { ar: "تجاوزت حد النشر لدى المنصّة. أعد الجدولة لاحقًا.", en: "The platform's posting limit was reached. Re-queue later." },
  duplicate: { ar: "المنصّة تقول إن هذا النص نُشر من قبل.", en: "The platform says this exact text was already posted." },
  rejected: { ar: "رفضت المنصّة المنشور.", en: "The platform rejected the post." },
  provider_error: { ar: "خطأ مؤقت لدى المنصّة.", en: "A temporary error on the platform's side." },
  outcome_unknown: {
    ar: "توقف النشر بعد الإرسال، فلا نعرف إن كان المنشور ظهر. تحقّق من حسابك قبل إعادة الجدولة.",
    en: "Publishing stopped after sending, so we can't tell whether the post went live. Check your account before re-queueing."
  }
};

export const POST_ERROR_TEXT: Record<PostErrorCode, BilingualText> = {
  partial: { ar: "نُشر على بعض المنصّات فقط.", en: "Published on some platforms only." },
  not_published: { ar: "لم يُنشر على أي منصّة.", en: "Not published on any platform." },
  outcome_unknown: PUBLISH_CODE_TEXT.outcome_unknown,
  plan_required: {
    ar: "النشر الاجتماعي يحتاج اشتراكًا فعّالًا في باقة تشمله.",
    en: "Social publishing needs an active subscription on a plan that includes it."
  },
  missed_window: {
    ar: "فات موعد المنشور بأكثر من ٦ ساعات (كان الوكيل موقوفًا أو المجدول متوقفًا). أعد جدولته للنشر.",
    en: "Its time passed more than 6 hours ago (the agent was paused or the scheduler was down). Re-queue it to publish."
  },
  too_many_attempts: {
    ar: "توقفت محاولات النشر بعد ٣ محاولات غير مكتملة.",
    en: "Publishing stopped after 3 incomplete attempts."
  },
  replaced: { ar: "استُبدل بخطة أحدث.", en: "Replaced by a newer plan." }
};

export function isPostErrorCode(value: unknown): value is PostErrorCode {
  return typeof value === "string" && (POST_ERROR_CODES as readonly string[]).includes(value);
}
