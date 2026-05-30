import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";

describe("token encryption", () => {
  it("round-trips when key is set", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-production-key-min-32-chars!!";
    const plain = "ya29.super-secret-oauth-token";
    const enc = encryptSecret(plain);
    expect(enc).toMatch(/^enc:v1:/);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("returns plaintext when key unset (dev fallback)", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const plain = "dev-token";
    expect(encryptSecret(plain)).toBe(plain);
    expect(decryptSecret(plain)).toBe(plain);
  });
});
