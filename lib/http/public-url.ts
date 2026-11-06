/**
 * The public URL(s) a provider may have signed for a request.
 *
 * Twilio signs the exact URL it was configured with (scheme, host, path, query).
 * Behind a reverse proxy `req.url` is the internal address, so the public URL is
 * rebuilt from the configured site URL (what number provisioning registers:
 * NEXT_PUBLIC_SITE_URL, lib/voice/twilio.ts), the legacy APP_BASE_URL /
 * NEXT_PUBLIC_APP_URL, and the forwarded host (what the dashboard showed the
 * merchant: window.location.origin). Accepting any of them does not weaken the
 * check — the signature still needs the secret.
 */

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

function originOf(base: string | undefined): string | null {
  const trimmed = base?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function publicUrlCandidates(req: Request): string[] {
  const url = new URL(req.url);
  const pathAndQuery = `${url.pathname}${url.search}`;
  const origins: string[] = [];

  for (const base of [process.env.NEXT_PUBLIC_SITE_URL, process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    const origin = originOf(base);
    if (origin) origins.push(origin);
  }

  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) ?? firstHeaderValue(req.headers.get("host"));
  if (host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) {
    const proto = firstHeaderValue(req.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
    if (proto === "https" || proto === "http") origins.push(`${proto}://${host}`);
  }
  origins.push(url.origin);

  return [...new Set(origins.map((o) => `${o}${pathAndQuery}`))];
}
