/**
 * Generic outbound webhook channel.
 *
 * Lets an employee deliver messages/events to an HTTPS endpoint the merchant controls
 * (their own CRM, a Zapier/Make hook, an internal service of theirs on the public
 * internet). The payload is JSON and — when a `signing_secret` is configured — signed with
 * HMAC-SHA256 in the `X-Arabclue-Signature` header so the receiver can verify it.
 *
 * SW-4: the URL is merchant-controlled, so delivery goes through the shared outbound guard
 * (lib/security/outbound-http.ts): every resolved address must be public, the connection
 * is pinned to the checked address, redirects are not followed, time and size are capped,
 * and the receiver's response body is never read into an error, a log or a model prompt.
 *
 * Outbound delivery is the whole feature here; there is no inbound counterpart.
 */
import { createHmac, randomBytes } from "crypto";
import {
  OutboundUrlError,
  parsePublicHttpUrl,
  requestPublicUrl,
  resolvePublicHttpTarget,
  sanitizeTenantHeaders,
  type LookupAll
} from "@/lib/security/outbound-http";

export type WebhookCredentials = {
  url: string;
  signing_secret?: string;
  headers?: Record<string, string>;
};

export type WebhookSendResult = { id: string; status: number };

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Synchronous URL check (scheme, credentials, port, IP literals, internal names). Kept for
 * callers that only have the text; delivery and connect also resolve DNS.
 */
export function assertPublicHttpUrl(raw: string): URL {
  try {
    return parsePublicHttpUrl(raw);
  } catch (err) {
    if (err instanceof OutboundUrlError) throw new Error(`Webhook: ${err.message}`);
    throw err;
  }
}

/** Connect-time check: the URL text and every address its host resolves to (OutboundUrlError when refused). */
export async function verifyWebhookUrl(raw: string, opts: { lookup?: LookupAll } = {}): Promise<URL> {
  const { url } = await resolvePublicHttpTarget(raw, opts);
  return url;
}

export async function sendWebhookMessage(
  creds: WebhookCredentials,
  to: string,
  body: string,
  subject?: string,
  opts: { lookup?: LookupAll } = {}
): Promise<WebhookSendResult> {
  if (!creds.url) throw new Error("Webhook: url missing");

  const id = `whk_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const payload = JSON.stringify({
    id,
    type: "employee.message",
    to,
    subject: subject ?? null,
    body,
    sent_at: new Date().toISOString()
  });

  const headers: Record<string, string> = {
    ...sanitizeTenantHeaders(creds.headers),
    "content-type": "application/json",
    "user-agent": "arabclue-employee-webhook/1"
  };
  if (creds.signing_secret) {
    const sig = createHmac("sha256", creds.signing_secret).update(payload).digest("hex");
    headers["x-arabclue-signature"] = `sha256=${sig}`;
  }

  let status: number;
  try {
    ({ status } = await requestPublicUrl(creds.url, {
      method: "POST",
      headers,
      body: payload,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      lookup: opts.lookup
    }));
  } catch (err) {
    if (err instanceof OutboundUrlError) throw new Error(`Webhook: refused — ${err.message}`);
    throw new Error(`Webhook delivery failed: ${err instanceof Error ? err.message : "network error"}`);
  }
  // Only the status is reported; the receiver's body never leaves this function.
  if (status >= 300 && status < 400) throw new Error(`Webhook delivery failed: HTTP ${status} (redirects are not followed)`);
  if (status < 200 || status >= 300) throw new Error(`Webhook delivery failed: HTTP ${status}`);
  return { id, status };
}
