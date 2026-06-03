import { getServiceSupabase } from "@/lib/db/supabase";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const SETTINGS_KEY = "secrets";
const DEFAULT_LOAD_TIMEOUT_MS = 3000;

type SecretsBlob = Record<string, string>;

/**
 * Upper bound (ms) for the boot-time secrets read. `instrumentation.ts` awaits
 * secret hydration on every server start, so an unreachable or slow Supabase must
 * fail fast and let the process boot on hPanel/process.env values rather than hang.
 * Tunable via PLATFORM_SECRETS_TIMEOUT_MS. Only the boot read is bounded — admin
 * writes (`savePlatformSecrets`) intentionally read without a timeout so a slow
 * response can never collapse the stored blob to `{}` and drop existing secrets.
 */
function bootLoadTimeoutMs(): number {
  const raw = Number(process.env.PLATFORM_SECRETS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOAD_TIMEOUT_MS;
}

export async function loadEncryptedSecrets(signal?: AbortSignal): Promise<SecretsBlob> {
  try {
    const supabase = getServiceSupabase();
    let query = supabase
      .from("platform_settings")
      .select("value")
      .eq("key", SETTINGS_KEY);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    if (error?.code === "42P01") return {};
    if (error) throw new Error(error.message);
    if (!data?.value || typeof data.value !== "object") return {};
    return data.value as SecretsBlob;
  } catch {
    return {};
  }
}

export async function loadDecryptedSecrets(): Promise<Record<string, string>> {
  // Boot path: bound the read and cancel the request so an unreachable database
  // can never hang server startup. On timeout we resolve to no secrets and let
  // the process come up on its hPanel/process.env values.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<SecretsBlob>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({});
    }, bootLoadTimeoutMs());
  });

  let encrypted: SecretsBlob;
  try {
    encrypted = await Promise.race([guard, loadEncryptedSecrets(controller.signal)]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const out: Record<string, string> = {};
  for (const [key, stored] of Object.entries(encrypted)) {
    if (!stored?.trim()) continue;
    try {
      out[key] = decryptSecret(stored);
    } catch {
      // Skip values that cannot decrypt (missing TOKEN_ENCRYPTION_KEY)
    }
  }
  return out;
}

export async function savePlatformSecrets(
  updates: Record<string, string | null | undefined>
): Promise<{ updated: string[]; skipped: string[] }> {
  const current = await loadEncryptedSecrets();
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (!MANAGED_SECRET_KEYS.includes(key)) {
      skipped.push(key);
      continue;
    }
    if (isBootstrapSecretKey(key)) {
      skipped.push(key);
      continue;
    }
    if (value === undefined) continue;
    if (value === null || value === "") {
      delete current[key];
      updated.push(key);
      continue;
    }
    current[key] = encryptSecret(value.trim());
    updated.push(key);
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("platform_settings").upsert(
    { key: SETTINGS_KEY, value: current, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error?.code === "42P01") {
    throw new Error("platform_settings table missing — run migration 0005_platform_settings.sql");
  }
  if (error) throw new Error(error.message);

  return { updated, skipped };
}
