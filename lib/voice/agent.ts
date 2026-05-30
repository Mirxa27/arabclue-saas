/**
 * arabclue voice agent — Module ٠٣.
 *
 * Answers a merchant's phone in Saudi/Gulf Arabic 24/7: order status, bookings,
 * FAQs, store hours, and clean escalation to a human. Built on the OpenAI Realtime API.
 *
 * Topology:
 *   Caller → Twilio/STC SIP → media stream → Realtime session (this config) → tools → Supabase/Salla
 *
 * This module owns:
 *   - the system instructions (dialect, persona, guardrails)
 *   - the tool schema the model can call mid-conversation
 *   - the tool dispatcher that executes those calls against merchant data
 *
 * PDPL note: call audio + transcripts are personal data. Persist only with consent,
 * default retention 30 days, and prefer in-Kingdom storage for production.
 */
import { z } from "zod";
import { sallaAPI } from "@/lib/salla/oauth";
import { getPersona } from "@/lib/agents/personas";
import { SallaOrdersResponseSchema, SallaProductsResponseSchema } from "@/lib/types/salla";

export type VoicePersona = {
  merchantId: string;
  storeName: string;
  /** "khaliji" recommended for KSA SMB phone lines */
  dialect: "khaliji" | "msa";
  /** free-text business hours, e.g., "9 صباحاً – 11 مساءً، السبت إلى الخميس" */
  hours?: string;
  /** human handoff number for escalation */
  escalationPhone?: string;
  /** extra knowledge the agent should know (return policy, delivery areas, etc.) */
  knowledge?: string;
};

const DIALECT_GUIDE: Record<VoicePersona["dialect"], string> = {
  khaliji:
    "تكلم بلهجة سعودية خليجية طبيعية ومحترمة. استخدم تعابير مثل «حيّاك الله»، «أبشر»، «تأمر». لا تتكلّف الفصحى إلا إذا طلب العميل ذلك.",
  msa: "تكلّم بالعربية الفصحى الواضحة والمهذّبة."
};

export function buildVoiceInstructions(merchantPersona: VoicePersona): string {
  const salem = getPersona("voice");

  return [
    salem.systemPrefix,
    "",
    `السياق: أنت تردّ على مكالمات متجر «${merchantPersona.storeName}».`,
    "",
    `أسلوب الكلام: ${salem.dialect === "khaliji" ? "اللهجة السعودية الخليجية الطبيعية والمحترمة" : "العربية الفصحى الواضحة والمهذبة"}.`,
    `استخدم عبارات سعودية أصيلة: «حيّاك الله»، «أبشر»، «تأمر»، «تفضّل».`,
    "",
    `سمات الشخصية: ${salem.traits.join("، ")} — ${salem.register === "professional" ? "سجل مهني محترم" : "سجل دافئ وودود"}.`,
    "",
    merchantPersona.hours ? `ساعات العمل: ${merchantPersona.hours}.` : "",
    merchantPersona.knowledge ? `معلومات إضافية عن المتجر: ${merchantPersona.knowledge}` : "",
    "",
    "قواعد صارمة:",
    "- لا تَعِد بمواعيد توصيل أو أسعار غير مؤكدة. استخدم الأدوات للتحقق من حالة الطلب أو توفّر المنتج.",
    "- إذا طلب العميل استرجاعاً أو شكوى أو ذكر جهة رقابية (مثل معروف أو هيئة) → استخدم أداة التصعيد فوراً.",
    "- لا تطلب بيانات حسّاسة (أرقام بطاقات، هوية كاملة). يكفي رقم الطلب أو الجوال.",
    "- اختصر. جملة أو جملتان في كل ردّ. اسأل سؤالاً واحداً في المرة.",
    "- إذا لم تفهم أو خرج الطلب عن نطاقك → صعّد بأدب بدل التخمين.",
    "- لا تستخدم أي محتوى غير لائق أو يخالف القيم.",
    "",
    "ابدأ المكالمة بترحيب قصير: «حيّاك الله، هاتف [اسم المتجر]، معك سالم. كيف أقدر أخدمك؟»"
  ]
    .filter(Boolean)
    .join("\n");
}

/** OpenAI Realtime session.update payload (server-authoritative config). */
export function buildRealtimeSessionConfig(persona: VoicePersona) {
  return {
    type: "session.update",
    session: {
      modalities: ["audio", "text"],
      voice: "alloy", // swap to an Arabic-tuned voice when available
      input_audio_format: "g711_ulaw", // Twilio default; use pcm16 for STC media streams
      output_audio_format: "g711_ulaw",
      input_audio_transcription: { model: "whisper-1", language: "ar" },
      turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 600 },
      instructions: buildVoiceInstructions(persona),
      tools: VOICE_TOOLS,
      tool_choice: "auto",
      temperature: 0.6
    }
  };
}

// ── Tool schema exposed to the model ─────────────────────────────────────────
export const VOICE_TOOLS = [
  {
    type: "function",
    name: "lookup_order",
    description: "Look up the status of a customer order by order number or the customer's mobile.",
    parameters: {
      type: "object",
      properties: {
        orderNumber: { type: "string", description: "Salla order number, if provided" },
        mobile: { type: "string", description: "Customer mobile in 05xxxxxxxx form, if provided" }
      }
    }
  },
  {
    type: "function",
    name: "check_product",
    description: "Check whether a product is available and its price.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Product name or keywords in Arabic or English" } },
      required: ["query"]
    }
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Create a booking/reservation request for the store (e.g., salon, clinic, fitting).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        mobile: { type: "string" },
        preferredTime: { type: "string", description: "ISO timestamp or natural language" },
        note: { type: "string" }
      },
      required: ["name", "mobile", "preferredTime"]
    }
  },
  {
    type: "function",
    name: "escalate_to_human",
    description: "Hand the call to a human. Use for complaints, refunds, legal/regulatory mentions, or anything out of scope.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" }, summary: { type: "string", description: "One-line summary for the human" } },
      required: ["reason"]
    }
  }
] as const;

// ── Tool dispatcher (server side) ────────────────────────────────────────────
export const ToolCallSchema = z.object({
  name: z.enum(["lookup_order", "check_product", "book_appointment", "escalate_to_human"]),
  arguments: z.record(z.unknown())
});

export type VoiceToolContext = {
  merchantId: string;
  accessToken: string; // Salla token for this merchant
  persona: VoicePersona;
  // injected side-effect deps so this stays testable
  recordBooking: (b: { name: string; mobile: string; preferredTime: string; note?: string }) => Promise<string>;
  notifyHuman: (reason: string, summary?: string) => Promise<void>;
};

export async function dispatchVoiceTool(
  call: z.infer<typeof ToolCallSchema>,
  ctx: VoiceToolContext
): Promise<{ output: string }> {
  switch (call.name) {
    case "lookup_order": {
      const { orderNumber, mobile } = call.arguments as { orderNumber?: string; mobile?: string };
      if (!orderNumber && !mobile) return { output: "أحتاج رقم الطلب أو رقم الجوال للبحث." };
      try {
        const q = orderNumber ? `?reference_id=${encodeURIComponent(orderNumber)}` : `?phone=${encodeURIComponent(mobile!)}`;
        const res = await sallaAPI<unknown>(`/orders${q}`, ctx.accessToken);
        const parsed = SallaOrdersResponseSchema.parse(res);
        const order = parsed.data?.[0];
        if (!order) return { output: "ما لقيت طلباً بهالبيانات. تأكد من الرقم لو سمحت." };
        return { output: `حالة الطلب: ${order.status?.name ?? "غير معروف"}. ${order.shipment ? "الشحنة في الطريق." : ""}` };
      } catch {
        return { output: "صار خطأ بسيط بالتحقق. أحوّلك لزميل بشري إذا تحب." };
      }
    }
    case "check_product": {
      const { query } = call.arguments as { query: string };
      try {
        const res = await sallaAPI<unknown>(`/products?keyword=${encodeURIComponent(query)}`, ctx.accessToken);
        const parsed = SallaProductsResponseSchema.parse(res);
        const p = parsed.data?.[0];
        if (!p) return { output: `ما لقيت «${query}» حالياً. تحب أبحث باسم ثاني؟` };
        const price =
          typeof p.price === "number"
            ? p.price
            : typeof p.price === "object" && p.price && "amount" in p.price
              ? p.price.amount
              : undefined;
        const inStock = (p.quantity ?? 1) > 0;
        return { output: `${p.name} ${inStock ? "متوفر" : "غير متوفر حالياً"}${price ? ` بسعر ${price} ريال` : ""}.` };
      } catch {
        return { output: "تعذّر التحقق الآن. أحوّلك لأحد الزملاء؟" };
      }
    }
    case "book_appointment": {
      const args = call.arguments as { name: string; mobile: string; preferredTime: string; note?: string };
      const id = await ctx.recordBooking(args);
      return { output: `تم تسجيل حجزك يا ${args.name}. رقم الحجز ${id}. بنأكد لك عبر رسالة. شي ثاني؟` };
    }
    case "escalate_to_human": {
      const { reason, summary } = call.arguments as { reason: string; summary?: string };
      await ctx.notifyHuman(reason, summary);
      return {
        output: ctx.persona.escalationPhone
          ? `بحوّلك لزميل من الفريق حالاً. لو انقطعت المكالمة تواصل على ${ctx.persona.escalationPhone}.`
          : "بحوّلك لزميل من الفريق حالاً، لحظة من فضلك."
      };
    }
  }
}
