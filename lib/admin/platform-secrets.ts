import { getServiceSupabase } from "@/lib/db/supabase";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const SETTINGS_KEY = "secrets";

type SecretsBlob = Record<string, string>;

export async function loadEncryptedSecrets(): Promise<SecretsBlob> {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error?.code === "42P01") return {};
    if (error) throw new Error(error.message);
    if (!data?.value || typeof data.value !== "object") return {};
    return data.value as SecretsBlob;
  } catch {
    return {};
  }
}

export async function loadDecryptedSecrets(): Promise<Record<string, string>> {
  const encrypted = await loadEncryptedSecrets();
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
