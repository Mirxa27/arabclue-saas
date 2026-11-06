/**
 * Email channel (kind "email"): the merchant's own Resend account and verified sender.
 *
 * SW-6: an AI employee's email always leaves under the merchant's identity — their Resend
 * API key and a `from` address on a domain verified in that account. There is no fallback
 * to the platform's RESEND_API_KEY or a platform sender: without the merchant's sender the
 * send fails visibly (EmailNotConfiguredError). Gmail-connected employees send through the
 * Gmail API instead (./gmail.ts). Platform mail (support, owner notifications) lives in
 * lib/email/platform.ts.
 */

export type EmailCredentials = {
  /** Verified sender on the merchant's domain, e.g. "Layla <layla@yourshop.sa>". */
  from: string;
  reply_to?: string;
  /** The merchant's own Resend API key (a sending-only key is enough). */
  api_key: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** The email channel has no merchant sender configured. */
export class EmailNotConfiguredError extends Error {
  constructor(message = "Email channel not configured: connect your Resend API key and a sender address on your domain.") {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

const RESEND_TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^\s@<>()",;:]+@([A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/;

/** The bare address of "Name <a@b.c>" or "a@b.c" (lower-cased), or null when it is not one. */
export function emailAddressOf(from: string): string | null {
  const trimmed = from.trim();
  const angle = /<([^<>]+)>\s*$/.exec(trimmed);
  const addr = (angle ? angle[1] : trimmed).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

export function emailDomainOf(from: string): string | null {
  const addr = emailAddressOf(from);
  return addr ? addr.slice(addr.indexOf("@") + 1) : null;
}

/** Domains a tenant may never send as: the platform's own (arabclue.com + EMAIL_FROM / SUPPORT_FROM_EMAIL domains). */
export function platformEmailDomains(): string[] {
  const out = new Set(["arabclue.com"]);
  for (const v of [process.env.EMAIL_FROM, process.env.SUPPORT_FROM_EMAIL]) {
    const d = v ? emailDomainOf(v) : null;
    if (d) out.add(d);
  }
  return [...out];
}

export function isPlatformEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return platformEmailDomains().some((p) => d === p || d.endsWith(`.${p}`));
}

/** The merchant's sender, or EmailNotConfiguredError. Never reads platform env keys. */
export function requireMerchantSender(creds: Partial<EmailCredentials> | Record<string, unknown>): EmailCredentials {
  const c = creds as Partial<EmailCredentials>;
  const apiKey = typeof c.api_key === "string" ? c.api_key.trim() : "";
  const from = typeof c.from === "string" ? c.from.trim() : "";
  if (!apiKey || !from) throw new EmailNotConfiguredError();
  const domain = emailDomainOf(from);
  if (!domain) throw new EmailNotConfiguredError("Email channel not configured: the sender address is not valid.");
  if (isPlatformEmailDomain(domain)) {
    throw new EmailNotConfiguredError("Email channel not configured: the sender must be on your own domain, not the platform's.");
  }
  const replyTo = typeof c.reply_to === "string" && c.reply_to.trim() ? c.reply_to.trim() : undefined;
  return { from, api_key: apiKey, ...(replyTo ? { reply_to: replyTo } : {}) };
}

export async function sendEmail(creds: EmailCredentials | Record<string, unknown>, message: EmailMessage): Promise<{ id: string }> {
  const sender = requireMerchantSender(creds);
  if (!emailAddressOf(message.to)) throw new Error("Email send failed: the recipient is not a valid email address.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sender.api_key}` },
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

// ─── connect-time check ────────────────────────────────────────────────────

export type ResendSenderCheck =
  | { ok: true; domainVerified: boolean | "unknown" }
  | { ok: false; code: "invalid_credentials" | "email_domain_unverified" | "provider_unavailable"; message: string };

/**
 * Ask the merchant's Resend account whether the sender's domain is verified
 * (GET /domains, https://resend.com/docs/api-reference/domains/list-domains). A
 * sending-only key cannot list domains ("restricted_api_key"): then the check is skipped —
 * Resend itself refuses to send from an unverified domain with that key.
 */
export async function checkResendSender(sender: EmailCredentials): Promise<ResendSenderCheck> {
  const domain = emailDomainOf(sender.from);
  if (!domain) return { ok: false, code: "invalid_credentials", message: "from: not a valid email address" };
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${sender.api_key}` },
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS)
    });
  } catch {
    return { ok: false, code: "provider_unavailable", message: "Could not reach Resend to check the sender domain. Try again." };
  }
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    message?: string;
    data?: Array<{ name?: string; status?: string }>;
  };
  if (!res.ok) {
    if (json.name === "restricted_api_key") return { ok: true, domainVerified: "unknown" };
    if (res.status >= 500) {
      return { ok: false, code: "provider_unavailable", message: "Resend is unavailable right now. Try again." };
    }
    return { ok: false, code: "invalid_credentials", message: "api_key: Resend rejected this API key" };
  }
  const domains = Array.isArray(json.data) ? json.data : [];
  // Resend verifies each sending domain on its own (a subdomain is a separate domain).
  const match = domains.find((d) => typeof d.name === "string" && d.name.toLowerCase() === domain);
  if (!match || match.status !== "verified") {
    return {
      ok: false,
      code: "email_domain_unverified",
      message: `from: ${domain} is not a verified domain in this Resend account`
    };
  }
  return { ok: true, domainVerified: true };
}
