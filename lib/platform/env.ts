import { loadDecryptedSecretsResult } from "@/lib/admin/platform-secrets";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/**
 * Values the process booted with (hPanel / .env) for every admin-managed key,
 * captured before the first hydration overwrites them. They are the fallback when
 * an admin clears a stored secret.
 */
let bootEnv: Map<string, string | undefined> | null = null;

function captureBootEnv(): Map<string, string | undefined> {
  if (!bootEnv) {
    bootEnv = new Map(
      MANAGED_SECRET_KEYS.filter((key) => !isBootstrapSecretKey(key)).map((key) => [key, process.env[key]])
    );
  }
  return bootEnv;
}

/**
 * Make process.env reflect the admin-stored secrets for every managed key:
 * stored value, else the boot-time (hPanel) value, else unset. Clearing a secret
 * in /admin/config therefore takes effect immediately on this instance instead of
 * lingering until a restart. If the database read fails or times out, the
 * current values are left untouched (a transient outage must not unset secrets).
 * Bootstrap keys (Supabase URL, service role, encryption key) are never touched.
 */
export async function hydratePlatformEnvFromDatabase(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const boot = captureBootEnv();
    const result = await loadDecryptedSecretsResult();
    if (!result.ok) return;
    for (const [key, bootValue] of boot) {
      const stored = result.secrets[key];
      const value = stored?.trim() ? stored : bootValue;
      if (value?.trim()) process.env[key] = value;
      else delete process.env[key];
    }
    hydrated = true;
  })();

  try {
    await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export function invalidatePlatformEnvCache(): void {
  hydrated = false;
}

export function isPlatformEnvHydrated(): boolean {
  return hydrated;
}

/** Prefer admin-stored value, then server env. */
export function getPlatformEnv(key: string): string | undefined {
  const value = process.env[key];
  return value?.trim() ? value : undefined;
}

/** Test hook: forget the captured boot-time values. */
export function resetPlatformEnvBootSnapshot(): void {
  bootEnv = null;
}
