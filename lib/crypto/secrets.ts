import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "enc:v1:";

function deriveKey(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) return null;
  return scryptSync(secret, "arabclue-token-salt", 32);
}

/** Encrypt OAuth tokens at rest. Falls back to plaintext when TOKEN_ENCRYPTION_KEY is unset (dev only). */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = deriveKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Decrypt stored token; accepts legacy plaintext values. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;

  const key = deriveKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY required to decrypt stored credentials");
  }

  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return stored;

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
