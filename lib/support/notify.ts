/**
 * Support auto-responder.
 *
 * Sends an immediate, bilingual acknowledgement to a merchant who submits a
 * support request, so they know it was received. Uses the same Resend transport
 * as the rest of the app. Throws when the transport is unavailable — callers run
 * this best-effort so a missing email config never fails the support submission.
 */
import { sendEmail } from "@/lib/employees/channels/email";

export type SupportCategory = "help" | "bug" | "feature" | "billing";

const CATEGORY_LABEL: Record<SupportCategory, { ar: string; en: string }> = {
  help: { ar: "مساعدة", en: "help" },
  bug: { ar: "بلاغ عن خطأ", en: "bug report" },
  feature: { ar: "اقتراح ميزة", en: "feature request" },
  billing: { ar: "الفوترة", en: "billing" }
};

export function buildSupportAckEmail(category: SupportCategory): { subject: string; text: string } {
  const label = CATEGORY_LABEL[category] ?? CATEGORY_LABEL.help;
  const subject = "تم استلام طلبك — arabclue | We received your request";
  const text = [
    "السلام عليكم،",
    `وصلنا طلبك (${label.ar}) وسيقوم فريق الدعم بالرد عليك في أقرب وقت ممكن، عادةً خلال يوم عمل واحد.`,
    "",
    "Hello,",
    `We've received your ${label.en} request. Our support team will get back to you shortly — usually within one business day.`,
    "",
    "— فريق arabclue / The arabclue team"
  ].join("\n");
  return { subject, text };
}

export async function sendSupportAck(input: { to: string; category: SupportCategory }): Promise<{ id: string }> {
  const from = process.env.SUPPORT_FROM_EMAIL ?? process.env.EMAIL_FROM ?? "support@arabclue.com";
  const replyTo = process.env.SUPPORT_REPLY_TO;
  const { subject, text } = buildSupportAckEmail(input.category);
  return sendEmail({ from, reply_to: replyTo }, { to: input.to, subject, text });
}
