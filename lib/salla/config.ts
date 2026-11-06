/**
 * Salla app configuration, read at call time (admin-saved values are hydrated into process.env;
 * NEXT_PUBLIC_* keys are read by computed name so Next does not inline the build-time value).
 */

/** Browser navigation that starts the Custom Mode OAuth flow (app/api/salla/oauth/start). */
export const SALLA_OAUTH_START_PATH = "/api/salla/oauth/start";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** Client credentials — needed to exchange codes and to refresh tokens (both modes). */
export function sallaAppCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = env("SALLA_CLIENT_ID");
  const clientSecret = env("SALLA_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Everything the Custom Mode start + callback need; null when the redirect flow is not set up. */
export function sallaOAuthRedirectConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const creds = sallaAppCredentials();
  const redirectUri = env("SALLA_REDIRECT_URI");
  return creds && redirectUri ? { ...creds, redirectUri } : null;
}

/** The Salla App Store install link (Easy Mode), when configured as an https URL. */
export function sallaAppStoreInstallUrl(): string | null {
  const raw = env("NEXT_PUBLIC_SALLA_INSTALL_URL");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type SallaConnectEntry =
  /** In-app OAuth (Custom Mode): binds the store to the signed-in merchant directly. */
  | { mode: "oauth"; url: string }
  /** Install from the Salla App Store (Easy Mode); the install is then claimed by email match. */
  | { mode: "app_store"; url: string }
  /** Neither is configured on this platform. */
  | { mode: "unavailable"; url: null };

/**
 * Where the dashboard's "Connect Salla" button goes. An App Store install link means the app is
 * listed, and listed apps must use Easy Mode (docs.salla.dev/doc-421118), so it wins over the in-app
 * Custom Mode flow, which is for development/testing (SALLA_REDIRECT_URI ships pre-filled).
 */
export function sallaConnectEntry(): SallaConnectEntry {
  const appStore = sallaAppStoreInstallUrl();
  if (appStore) return { mode: "app_store", url: appStore };
  if (sallaOAuthRedirectConfig()) return { mode: "oauth", url: SALLA_OAUTH_START_PATH };
  return { mode: "unavailable", url: null };
}
