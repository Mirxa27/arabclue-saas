import { loadDecryptedSecrets } from "@/lib/admin/platform-secrets";

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/**
 * Merge platform secrets from Supabase into process.env (admin-managed keys only).
 * Bootstrap keys (Supabase URL, service role, encryption key) stay in hPanel .env.
 */
export async function hydratePlatformEnvFromDatabase(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const secrets = await loadDecryptedSecrets();
    for (const [key, value] of Object.entries(secrets)) {
      if (value?.trim()) {
        process.env[key] = value;
      }
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
