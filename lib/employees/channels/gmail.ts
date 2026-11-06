/**
 * Gmail channel (kind "gmail"): the merchant's own Google account, via the OAuth token the
 * employee OAuth flow stored (scope gmail.send).
 *
 * SW-6: messages go out with the Gmail API as the connected account
 * (POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send, `raw` = base64url
 * RFC 5322 message — https://developers.google.com/gmail/api/guides/sending), never through
 * the platform's Resend account. An access token that has expired (or is rejected with 401)
 * is refreshed once with the stored refresh_token (https://oauth2.googleapis.com/token,
 * grant_type=refresh_token) and the new token is handed to `onTokenRefresh` to be saved.
 */

export type GmailCredentials = {
  access_token: string;
  refresh_token?: string;
  /** The connected Google account (userinfo email). */
  email?: string;
  /** Legacy rows: the userinfo email (or name) stored as the label. */
  external_label?: string;
  /** ISO expiry of access_token, when known. */
  token_expires_at?: string;
};

export type GmailMessage = { to: string; subject: string; text: string };

export type RefreshedGoogleToken = { access_token: string; token_expires_at: string | null };

export class GmailNotConfiguredError extends Error {
  constructor(message = "Gmail channel not configured: reconnect Gmail.") {
    super(message);
    this.name = "GmailNotConfiguredError";
  }
}

const GOOGLE_TIMEOUT_MS = 15_000;
const EXPIRY_SKEW_MS = 60_000;
const ADDRESS_RE = /^[^\s@<>()",;:\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value.trim());
}

/** The sending account's address, when the stored credentials know it. */
export function gmailSenderAddress(creds: Partial<GmailCredentials>): string | null {
  if (isAddress(creds.email)) return creds.email.trim();
  if (isAddress(creds.external_label)) return creds.external_label.trim();
  return null;
}

function encodeHeaderWord(value: string): string {
  // RFC 2047 encoded-word keeps Arabic subjects intact; CR/LF cannot survive base64.
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, (line) => `${line}\r\n`).trimEnd();
}

/** RFC 5322 message (text/plain, UTF-8, base64 body) — exported for tests. */
export function buildGmailMime(from: string | null, message: GmailMessage): string {
  if (!isAddress(message.to)) throw new Error("Gmail send failed: the recipient is not a valid email address.");
  const headers = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${message.to.trim()}`,
    `Subject: ${encodeHeaderWord(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64"
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(Buffer.from(message.text, "utf8").toString("base64"))}\r\n`;
}

/** Exchange a refresh token for a new Google access token. */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<RefreshedGoogleToken> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GmailNotConfiguredError("Google OAuth is not configured on this deployment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    }).toString(),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new GmailNotConfiguredError(`Google refused to refresh the token (${json.error ?? `HTTP ${res.status}`}): reconnect Gmail.`);
  }
  const expiresAt = typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null;
  return { access_token: json.access_token, token_expires_at: expiresAt };
}

function expiresSoon(iso: string | undefined | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t - Date.now() < EXPIRY_SKEW_MS;
}

export type GmailSendOptions = {
  /** Persist a refreshed access token (encrypted) so the next send reuses it. */
  onTokenRefresh?: (next: RefreshedGoogleToken) => Promise<void>;
};

export async function sendGmailMessage(
  creds: GmailCredentials | Record<string, unknown>,
  message: GmailMessage,
  opts: GmailSendOptions = {}
): Promise<{ id: string }> {
  const c = creds as Partial<GmailCredentials>;
  let token = typeof c.access_token === "string" ? c.access_token : "";
  const refreshToken = typeof c.refresh_token === "string" && c.refresh_token ? c.refresh_token : null;
  if (!token && !refreshToken) throw new GmailNotConfiguredError();

  const raw = Buffer.from(buildGmailMime(gmailSenderAddress(c), message), "utf8").toString("base64url");

  const refresh = async () => {
    if (!refreshToken) throw new GmailNotConfiguredError("The Gmail token expired and no refresh token is stored: reconnect Gmail.");
    const next = await refreshGoogleAccessToken(refreshToken);
    token = next.access_token;
    await opts.onTokenRefresh?.(next);
  };

  if (!token || expiresSoon(c.token_expires_at)) await refresh();

  const send = () =>
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
    });

  let res = await send();
  if (res.status === 401 && refreshToken) {
    await refresh();
    res = await send();
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(`Gmail send failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return { id: json.id };
}
