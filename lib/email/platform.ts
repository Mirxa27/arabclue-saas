/**
 * Platform email: mail arabclue itself sends (support acknowledgements, the support-inbox
 * relay, owner notifications such as an AI employee's escalation), on the platform's own
 * Resend account (RESEND_API_KEY) and sender.
 *
 * Never use this for mail an AI employee sends on a merchant's behalf — that goes out
 * under the merchant's own sender (lib/employees/channels/email.ts, gmail.ts) — so the
 * platform's domain and account cannot be used as a relay for tenant traffic (SW-6).
 */

export type PlatformSender = { from: string; reply_to?: string };

export type PlatformEmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const RESEND_TIMEOUT_MS = 15_000;

export function isPlatformEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** The platform's default sender address (EMAIL_FROM, else SUPPORT_FROM_EMAIL). */
export function platformFromAddress(): string | null {
  const from = process.env.EMAIL_FROM?.trim() || process.env.SUPPORT_FROM_EMAIL?.trim();
  return from || null;
}

export async function sendPlatformEmail(sender: PlatformSender, message: PlatformEmailMessage): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Email send unavailable: set RESEND_API_KEY.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: sender.from,
      to: [message.to],
      reply_to: sender.reply_to,
      subject: message.subject,
      text: message.text,
      html: message.html
    }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS)
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Email send failed: ${json.message ?? res.statusText}`);
  return { id: json.id ?? "" };
}
