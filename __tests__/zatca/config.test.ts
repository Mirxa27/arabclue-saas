/** lib/zatca/config.ts (environment selection) and the strict credential encryption ZATCA uses. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getZatcaConfig, ZATCA_BASE_URLS, ZatcaConfigError } from "@/lib/zatca/config";
import { decryptSecretStrict, encryptSecretStrict, EncryptionKeyMissingError, hasEncryptionKey } from "@/lib/crypto/secrets";

describe("getZatcaConfig", () => {
  it("is not configured without ZATCA_ENVIRONMENT or ZATCA_FATOORA_BASE", () => {
    expect(getZatcaConfig({})).toBeNull();
  });

  it("maps each environment to ZATCA's gateway", () => {
    expect(getZatcaConfig({ ZATCA_ENVIRONMENT: "sandbox" })).toEqual({ environment: "sandbox", baseUrl: ZATCA_BASE_URLS.sandbox });
    expect(getZatcaConfig({ ZATCA_ENVIRONMENT: "Production" })).toEqual({ environment: "production", baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core" });
    expect(getZatcaConfig({ ZATCA_ENVIRONMENT: "simulation" })?.baseUrl).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation");
  });

  it("derives the environment from a legacy ZATCA_FATOORA_BASE and refuses contradictions", () => {
    expect(getZatcaConfig({ ZATCA_FATOORA_BASE: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/" })).toEqual({
      environment: "sandbox",
      baseUrl: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal"
    });
    expect(() => getZatcaConfig({ ZATCA_ENVIRONMENT: "production", ZATCA_FATOORA_BASE: ZATCA_BASE_URLS.sandbox })).toThrow(ZatcaConfigError);
    expect(() => getZatcaConfig({ ZATCA_FATOORA_BASE: "http://gw-fatoora.zatca.gov.sa/e-invoicing/core" })).toThrow(/https/);
    expect(() => getZatcaConfig({ ZATCA_FATOORA_BASE: "https://proxy.example/zatca" })).toThrow(/ZATCA_ENVIRONMENT/);
    expect(getZatcaConfig({ ZATCA_ENVIRONMENT: "simulation", ZATCA_FATOORA_BASE: "https://proxy.example/zatca" })).toEqual({ environment: "simulation", baseUrl: "https://proxy.example/zatca" });
    expect(() => getZatcaConfig({ ZATCA_ENVIRONMENT: "staging" })).toThrow(ZatcaConfigError);
  });
});

describe("encryptSecretStrict", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never falls back to plaintext", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(hasEncryptionKey()).toBe(false);
    expect(() => encryptSecretStrict("-----BEGIN PRIVATE KEY-----")).toThrow(EncryptionKeyMissingError);
  });

  it("round-trips and refuses plaintext on the way back", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
    const enc = encryptSecretStrict("secret-value");
    expect(enc).toMatch(/^enc:v1:/);
    expect(decryptSecretStrict(enc)).toBe("secret-value");
    expect(() => decryptSecretStrict("secret-value")).toThrow(/not encrypted/);
  });
});
