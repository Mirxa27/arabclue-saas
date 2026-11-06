/**
 * Fixed Arabic + English text for the stable codes the voice API returns (`{ error, code }`)
 * and for the line states / call outcomes the voice page shows. Pages render these, never the
 * response's free text. Pure module — safe to import from client components.
 */
import type { BilingualText } from "@/lib/salla/messages";
import type { VoiceCallDeclineReason, VoiceCallOutcome, VoiceLineState, VoiceStateReason } from "@/lib/voice/types";

export const VOICE_ERROR_MESSAGES = {
  plan_required: {
    ar: "باقتك الحالية لا تشمل المساعد الصوتي أو أن اشتراكك غير مفعّل — اختر باقة Plus أو Pro من صفحة الفوترة.",
    en: "Your plan doesn't include the voice agent or your subscription isn't active — choose Plus or Pro on the Billing page."
  },
  voice_platform_disabled: {
    ar: "المساعد الصوتي موقوف على مستوى المنصّة حالياً.",
    en: "The voice agent is switched off platform-wide right now."
  },
  voice_bridge_not_configured: {
    ar: "خدمة ربط المكالمات بالمساعد غير مُعدّة على المنصّة بعد، لذلك لا يمكن تشغيل الخط أو شراء رقم.",
    en: "The platform's call bridge isn't set up yet, so the line can't be switched on and no number can be bought."
  },
  twilio_not_configured: {
    ar: "مزوّد الأرقام (Twilio) غير مُعدّ على المنصّة بعد.",
    en: "The phone-number provider (Twilio) isn't configured on the platform yet."
  },
  provisioning_in_progress: {
    ar: "جارٍ شراء رقم لمتجرك الآن. حاول بعد دقيقة.",
    en: "A number is already being bought for your store. Try again in a minute."
  },
  provisioning_rate_limited: {
    ar: "وصلت للحد اليومي لشراء الأرقام. حاول غداً.",
    en: "You've reached today's limit for buying numbers. Try again tomorrow."
  },
  release_failed: {
    ar: "تعذّر إلغاء الرقم الحالي، لذلك لم يُشترَ رقم جديد. حاول لاحقاً.",
    en: "The current number couldn't be released, so no new number was bought. Try again later."
  },
  purchase_failed: {
    ar: "تعذّر شراء رقم الآن. حاول لاحقاً.",
    en: "A number couldn't be bought right now. Try again later."
  },
  invalid_escalation_phone: {
    ar: "رقم التحويل غير صالح. اكتبه بالصيغة الدولية مثل ‎+9665XXXXXXXX‎ أو ‎05XXXXXXXX‎.",
    en: "The hand-over number isn't valid. Use the international format (+9665XXXXXXXX) or 05XXXXXXXX."
  },
  nothing_to_update: {
    ar: "لم يتغيّر شيء لحفظه.",
    en: "Nothing changed to save."
  },
  not_found: {
    ar: "لم نجد هذا العنصر.",
    en: "That item wasn't found."
  },
  rate_limited: {
    ar: "محاولات كثيرة خلال وقت قصير. حاول بعد قليل.",
    en: "Too many attempts in a short time. Try again shortly."
  },
  merchant_required: {
    ar: "أكمل إعداد متجرك أولاً.",
    en: "Finish setting up your store first."
  },
  not_signed_in: {
    ar: "انتهت جلستك. سجّل الدخول مرة أخرى.",
    en: "Your session has ended. Sign in again."
  },
  invalid_json: {
    ar: "تعذّر قراءة الطلب. حدّث الصفحة وحاول مرة أخرى.",
    en: "The request couldn't be read. Refresh the page and try again."
  },
  network: {
    ar: "تعذّر الاتصال بالخادم. تحقّق من اتصالك وحاول مرة أخرى.",
    en: "Couldn't reach the server. Check your connection and try again."
  },
  unknown: {
    ar: "تعذّر إكمال العملية. حاول مرة أخرى.",
    en: "That didn't work. Please try again."
  }
} as const satisfies Record<string, BilingualText>;

export type VoiceErrorCode = keyof typeof VOICE_ERROR_MESSAGES;

export function voiceErrorMessage(code: string | null | undefined): BilingualText {
  return code && Object.prototype.hasOwnProperty.call(VOICE_ERROR_MESSAGES, code)
    ? VOICE_ERROR_MESSAGES[code as VoiceErrorCode]
    : VOICE_ERROR_MESSAGES.unknown;
}

export const VOICE_STATE_TEXT: Record<VoiceLineState, { title: BilingualText; body: BilingualText }> = {
  active: {
    title: { ar: "المساعد يردّ على المكالمات", en: "Answering calls" },
    body: {
      ar: "المكالمات الواردة على رقم متجرك يردّ عليها سالم الآن.",
      en: "Incoming calls to your store's number are answered by Salem."
    }
  },
  needs_number: {
    title: { ar: "بانتظار رقم الهاتف", en: "Waiting for a phone number" },
    body: {
      ar: "المساعد مفعّل لكن لا يوجد رقم بعد، فلا تصل أي مكالمة. احصل على رقم من الأسفل.",
      en: "The agent is on but there's no number yet, so no calls arrive. Get a number below."
    }
  },
  paused: {
    title: { ar: "المساعد موقوف", en: "Agent paused" },
    body: {
      ar: "المتصلون يسمعون أن الرقم غير متاح حالياً حتى تعيد التشغيل.",
      en: "Callers hear that the number is unavailable until you switch it back on."
    }
  },
  unavailable: {
    title: { ar: "الخط لا يستقبل مكالمات", en: "The line isn't taking calls" },
    body: {
      ar: "لا يمكن للمساعد الرد الآن للأسباب الموضّحة أدناه.",
      en: "The agent can't answer right now for the reasons below."
    }
  }
};

export const VOICE_REASON_TEXT: Record<VoiceStateReason, BilingualText> = {
  plan_required: VOICE_ERROR_MESSAGES.plan_required,
  platform_disabled: VOICE_ERROR_MESSAGES.voice_platform_disabled,
  bridge_not_configured: VOICE_ERROR_MESSAGES.voice_bridge_not_configured,
  twilio_not_configured: VOICE_ERROR_MESSAGES.twilio_not_configured,
  number_missing: {
    ar: "لا يوجد رقم هاتف لمتجرك بعد.",
    en: "Your store has no phone number yet."
  },
  provisioning: VOICE_ERROR_MESSAGES.provisioning_in_progress,
  agent_off: {
    ar: "المساعد موقوف من قِبلك.",
    en: "You switched the agent off."
  }
};

export const VOICE_CALL_OUTCOME_TEXT: Record<VoiceCallOutcome, BilingualText> = {
  bridged: { ar: "ردّ عليها المساعد", en: "Answered by the agent" },
  forwarded: { ar: "حُوّلت إلى رقم المتجر", en: "Forwarded to your store number" },
  not_bridged: { ar: "لم تُوصل (الخدمة غير مُعدّة)", en: "Not connected (service not set up)" },
  declined: { ar: "لم يُرَد عليها", en: "Not answered" }
};

export const VOICE_DECLINE_TEXT: Record<VoiceCallDeclineReason, BilingualText> = {
  agent_off: { ar: "المساعد كان موقوفاً", en: "agent was paused" },
  plan: { ar: "الباقة لا تشمل المساعد الصوتي", en: "plan doesn't include voice" },
  platform_off: { ar: "الخدمة موقوفة على المنصّة", en: "voice was off platform-wide" }
};
