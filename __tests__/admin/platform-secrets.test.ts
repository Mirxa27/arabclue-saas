import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import { MANAGED_SECRET_KEYS, isBootstrapSecretKey } from "@/lib/admin/secret-registry";

describe("platform secrets registry", () => {
  it("lists managed keys without bootstrap entries", () => {
    expect(MANAGED_SECRET_KEYS).toContain("OPENAI_API_KEY");
    expect(MANAGED_SECRET_KEYS).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("marks bootstrap keys", () => {
    expect(isBootstrapSecretKey("TOKEN_ENCRYPTION_KEY")).toBe(true);
    expect(isBootstrapSecretKey("CRON_SECRET")).toBe(false);
  });
});

describe("secret encryption roundtrip", () => {
  const prev = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-32-chars-min!!";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = prev;
  });

  it("encrypts and decrypts values", () => {
    const plain = "sk-test-openai-key";
    const enc = encryptSecret(plain);
    expect(enc).toMatch(/^enc:v1:/);
    expect(decryptSecret(enc)).toBe(plain);
  });
});
