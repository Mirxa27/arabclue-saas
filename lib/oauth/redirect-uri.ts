/** Build OAuth callback URLs from NEXT_PUBLIC_SITE_URL. */
export function oauthCallbackUri(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
