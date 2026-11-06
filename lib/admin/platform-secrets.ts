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

/**
 * Read the stored (encrypted) secrets blob. Throws on any read failure — except a
 * missing platform_settings table, which means "no secrets yet". Callers that
 * WRITE the blob must use this: treating a failed read as `{}` and upserting would
 * silently erase every other stored secret.
 */
async function readEncryptedSecrets(signal?: AbortSignal): Promise<SecretsBlob> {
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
}

/** Best-effort read for display paths: any failure reads as "no stored secrets". */
export async function loadEncryptedSecrets(signal?: AbortSignal): Promise<SecretsBlob> {
  try {
    return await readEncryptedSecrets(signal);
  } catch {
    return {};
  }
}

export type DecryptedSecretsLoad =
  | { ok: true; secrets: Record<string, string> }
  | { ok: false; secrets: Record<string, string>; reason: "timeout" | "error" };

/**
 * Boot/hydration read: bounded by PLATFORM_SECRETS_TIMEOUT_MS and cancelled on
 * timeout so an unreachable database can never hang server startup. Reports
 * whether the read succeeded, so callers can tell "no secrets stored" apart from
 * "could not read" (and keep the values they already have in the latter case).
 */
export async function loadDecryptedSecretsResult(): Promise<DecryptedSecretsLoad> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMEOUT = Symbol("timeout");
  const guard = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, bootLoadTimeoutMs());
  });

  let encrypted: SecretsBlob;
  try {
    const raced = await Promise.race([guard, readEncryptedSecrets(controller.signal)]);
    if (raced === TIMEOUT) return { ok: false, secrets: {}, reason: "timeout" };
    encrypted = raced;
  } catch {
    return { ok: false, secrets: {}, reason: "error" };
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
  return { ok: true, secrets: out };
}

/** Decrypted secrets, or `{}` when the read fails or times out (boot fallback to hPanel env). */
export async function loadDecryptedSecrets(): Promise<Record<string, string>> {
  return (await loadDecryptedSecretsResult()).secrets;
}

export async function savePlatformSecrets(
  updates: Record<string, string | null | undefined>
): Promise<{ updated: string[]; skipped: string[] }> {
  // Must not fall back to {} on a failed read: the upsert below would erase every other secret.
  const current = await readEncryptedSecrets();
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
