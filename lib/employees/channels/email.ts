/**
 * Email adapter.
 *
 * Default transport is Resend (HTTP API, simple to configure). If RESEND_API_KEY
 * is not set, falls back to a no-op so the employee can still queue drafts.
 */

export type EmailCredentials = {
  from: string;               // verified sender, e.g. layla@yourshop.sa
  reply_to?: string;
  api_key?: string;           // override of global RESEND_API_KEY
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(creds: EmailCredentials, message: EmailMessage): Promise<{ id: string }> {
  const apiKey = creds.api_key ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email send unavailable: set RESEND_API_KEY or per-employee api_key.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: creds.from,
      to: [message.to],
      reply_to: creds.reply_to,
      subject: message.subject,
      text: message.text,
      html: message.html
    })
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Email send failed: ${json.message ?? res.statusText}`);
  return { id: json.id ?? "" };
}
