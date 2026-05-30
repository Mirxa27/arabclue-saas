import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";

const ENVELOPE_KEY = "_enc";

const SENSITIVE_KEYS = new Set([
  "access_token",
  "bot_token",
  "refresh_token",
  "verify_token",
  "webhook_secret",
  "signing_secret",
  "smtp_pass",
  "api_key",
  "secret",
  "password",
  "token"
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || lower.includes("token") || lower.includes("secret") || lower.includes("pass");
}

/** Encrypt integration credentials for storage in `ai_employee_integrations.credentials`. */
export function encryptIntegrationCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  if (!credentials || Object.keys(credentials).length === 0) return {};
  const json = JSON.stringify(credentials);
  const encrypted = encryptSecret(json);
  if (encrypted === json) return credentials;
  return { [ENVELOPE_KEY]: encrypted };
}

/** Decrypt stored credentials; accepts legacy plaintext jsonb objects. */
export function decryptIntegrationCredentials(
  stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!stored || typeof stored !== "object") return {};
  const enc = stored[ENVELOPE_KEY];
  if (typeof enc === "string" && enc.length > 0) {
    try {
      const json = decryptSecret(enc);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return { ...stored };
}

/** Strip secrets from integration rows returned to the dashboard. */
export function redactIntegrationRow<T extends { credentials?: Record<string, unknown> }>(
  row: T
): Omit<T, "credentials"> & { credentials_configured: string[] } {
  const creds = decryptIntegrationCredentials(row.credentials);
  const configured = Object.keys(creds).filter((k) => {
    const v = creds[k];
    return v !== null && v !== undefined && String(v).length > 0;
  });
  const { credentials: _c, ...rest } = row;
  return { ...rest, credentials_configured: configured };
}

/** Mask credential values for optional debug/admin surfaces. */
export function maskCredentialPreview(credentials: Record<string, unknown>): Record<string, string> {
  const plain = decryptIntegrationCredentials(credentials);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(plain)) {
    if (value === null || value === undefined) continue;
    const str = String(value);
    if (!str) continue;
    if (isSensitiveKey(key)) {
      out[key] = str.length <= 4 ? "••••" : `${str.slice(0, 2)}••••${str.slice(-2)}`;
    } else {
      out[key] = str;
    }
  }
  return out;
}
