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

/**
 * Acknowledge a request. `to` must be the signed-in account's own address — never an
 * address taken from the request body (that turned the platform sender into an open
 * relay for arbitrary recipients).
 */
export async function sendSupportAck(input: { to: string; category: SupportCategory }): Promise<{ id: string }> {
  const from = process.env.SUPPORT_FROM_EMAIL ?? process.env.EMAIL_FROM ?? "support@arabclue.com";
  const replyTo = process.env.SUPPORT_REPLY_TO;
  const { subject, text } = buildSupportAckEmail(input.category);
  return sendEmail({ from, reply_to: replyTo }, { to: input.to, subject, text });
}

/** Resend is the transport for both the acknowledgement and the inbox relay. */
export function isSupportEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export type ForwardedTicket = {
  id: string;
  category: SupportCategory;
  message: string;
  accountEmail: string | null;
  contactEmail: string | null;
  merchantId: string | null;
  merchantName: string | null;
  createdAt: string;
};

export function buildSupportForwardEmail(ticket: ForwardedTicket): { subject: string; text: string } {
  const label = CATEGORY_LABEL[ticket.category] ?? CATEGORY_LABEL.help;
  const subject = `[arabclue support · ${label.en}] ${ticket.merchantName ?? ticket.accountEmail ?? ticket.id}`;
  const text = [
    `Ticket: ${ticket.id}`,
    `Category: ${label.en} / ${label.ar}`,
    `Received: ${ticket.createdAt}`,
    `Account email: ${ticket.accountEmail ?? "(none)"}`,
    `Reply to: ${ticket.contactEmail ?? ticket.accountEmail ?? "(none)"}`,
    `Merchant: ${ticket.merchantName ?? "(no store yet)"}${ticket.merchantId ? ` (${ticket.merchantId})` : ""}`,
    "",
    ticket.message
  ].join("\n");
  return { subject, text };
}

/**
 * Relay a stored ticket to the support inbox (SUPPORT_INBOX_EMAIL). Returns
 * not_configured when the inbox or the email transport is not set up; throws on a
 * transport failure so the caller can report it.
 */
export async function forwardSupportTicket(
  ticket: ForwardedTicket
): Promise<{ status: "sent"; id: string } | { status: "not_configured" }> {
  const inbox = process.env.SUPPORT_INBOX_EMAIL?.trim();
  if (!inbox || !isSupportEmailConfigured()) return { status: "not_configured" };
  const from = process.env.SUPPORT_FROM_EMAIL ?? process.env.EMAIL_FROM ?? "support@arabclue.com";
  const { subject, text } = buildSupportForwardEmail(ticket);
  const replyTo = ticket.contactEmail ?? ticket.accountEmail ?? undefined;
  const { id } = await sendEmail({ from, reply_to: replyTo }, { to: inbox, subject, text });
  return { status: "sent", id };
}
