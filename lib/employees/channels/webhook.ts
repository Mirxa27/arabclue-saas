/**
 * Generic outbound webhook channel.
 *
 * Lets an employee deliver messages/events to any HTTPS endpoint the merchant
 * controls (their own CRM, a Zapier/Make hook, an internal service). The payload
 * is JSON and — when a `signing_secret` is configured — signed with HMAC-SHA256
 * in the `X-Arabclue-Signature` header so the receiver can verify authenticity.
 *
 * Outbound delivery is the whole feature here; there is no inbound counterpart.
 */
import { createHmac } from "crypto";

export type WebhookCredentials = {
  url: string;
  signing_secret?: string;
  headers?: Record<string, string>;
};

export type WebhookSendResult = { id: string; status: number };

/**
 * Best-effort SSRF guard: reject delivery to loopback / private / link-local
 * hosts by literal inspection. DNS-rebinding is out of scope (would require
 * resolving and pinning the address); this blocks the common accidental and
 * naive-malicious cases (localhost, 169.254.169.254 metadata, RFC1918).
 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Webhook: url is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Webhook: url must be http(s)");
  }
  // WHATWG URL keeps IPv6 literals bracketed (e.g. "[::1]") — strip for matching.
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (
    host === "localhost" ||
    host === "ip6-localhost" ||
    host === "ip6-loopback" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Webhook: refusing to deliver to a loopback/private host");
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    const isPrivate =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (isPrivate) throw new Error("Webhook: refusing to deliver to a private IPv4 range");
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    throw new Error("Webhook: refusing to deliver to a private IPv6 range");
  }
  return u;
}

export async function sendWebhookMessage(
  creds: WebhookCredentials,
  to: string,
  body: string,
  subject?: string
): Promise<WebhookSendResult> {
  if (!creds.url) throw new Error("Webhook: url missing");
  assertPublicHttpUrl(creds.url);

  const id = `whk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({
    id,
    type: "employee.message",
    to,
    subject: subject ?? null,
    body,
    sent_at: new Date().toISOString()
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "arabclue-employee-webhook/1",
    ...(creds.headers ?? {})
  };
  if (creds.signing_secret) {
    const sig = createHmac("sha256", creds.signing_secret).update(payload).digest("hex");
    headers["x-arabclue-signature"] = `sha256=${sig}`;
  }

  const res = await fetch(creds.url, { method: "POST", headers, body: payload });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook delivery failed: ${res.status} ${text.slice(0, 160)}`);
  }
  return { id, status: res.status };
}
